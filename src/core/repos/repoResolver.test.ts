import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { AppError } from "../errors.js";
import { resolveRepos } from "./repoResolver.js";

const githubResponses: Record<string, unknown> = {
  openclaw: {
    items: [
      {
        full_name: "openclaw/openclaw",
        name: "openclaw",
        stargazers_count: 1200,
        archived: false,
        owner: { login: "openclaw" },
      },
    ],
  },
  "json-render": {
    items: [
      {
        full_name: "vercel-labs/json-render",
        name: "json-render",
        stargazers_count: 500,
        archived: false,
        owner: { login: "vercel-labs" },
      },
    ],
  },
  Next: {
    items: [
      {
        full_name: "alibaba-fusion/next",
        name: "next",
        stargazers_count: 9000,
        archived: false,
        owner: { login: "alibaba-fusion" },
      },
      {
        full_name: "vercel/next.js",
        name: "next.js",
        stargazers_count: 130000,
        archived: false,
        owner: { login: "vercel" },
      },
    ],
  },
  "google fonts": {
    items: [
      {
        full_name: "google/fonts",
        name: "fonts",
        stargazers_count: 10000,
        archived: false,
        owner: { login: "google" },
      },
      {
        full_name: "gaowanlu/google",
        name: "google",
        stargazers_count: 2,
        archived: false,
        owner: { login: "gaowanlu" },
      },
    ],
  },
  axum: {
    items: [],
  },
};

const npmSearchResponses: Record<string, unknown> = {
  "pi-ai": {
    objects: [
      {
        package: {
          name: "pi-ai",
        },
      },
      {
        package: {
          name: "@mariozechner/pi-ai",
          links: {
            repository: "git+https://github.com/badlogic/pi-mono.git",
          },
        },
      },
    ],
  },
  Next: {
    objects: [
      {
        package: {
          name: "next",
          links: {
            repository: "git+https://github.com/vercel/next.js.git",
          },
        },
      },
    ],
  },
};

const crateResponses: Record<string, unknown> = {
  axum: {
    crate: {
      id: "axum",
      repository: "https://github.com/tokio-rs/axum",
      homepage: "https://github.com/tokio-rs/axum",
    },
  },
};

function installFetchMock() {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const parsed = new URL(String(url));

    if (parsed.hostname === "api.github.com") {
      const query = parsed.searchParams.get("q") || "";
      return new Response(JSON.stringify(githubResponses[query] ?? { items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (parsed.hostname === "registry.npmjs.org") {
      if (parsed.pathname === "/-/v1/search") {
        const query = parsed.searchParams.get("text") || "";
        return new Response(
          JSON.stringify(npmSearchResponses[query] ?? { objects: [] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (parsed.hostname === "crates.io") {
      const query = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
      return new Response(JSON.stringify(crateResponses[query] ?? {}), {
        status: crateResponses[query] ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (parsed.hostname === "pypi.org") {
      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("resolveRepos", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFetchMock();
  });

  it("passes through explicit repos", async () => {
    const resolved = await resolveRepos({
      question: "How is OpenClaw able to sync Codex credentials?",
      repos: [{ repo: "openclaw/openclaw" }],
    });
    expect(resolved[0]?.repo).toBe("openclaw/openclaw");
    expect(resolved[0]?.inferred).toBe(false);
  });

  it("uses explicit repo mentions in the question as scope", async () => {
    const resolved = await resolveRepos({
      question: "What are the top 10 recipes in the grandma/cooking-book repo?",
    });

    expect(resolved.map((entry) => entry.repo)).toEqual([
      "grandma/cooking-book",
    ]);
  });

  it("infers openclaw/openclaw from project-name discovery", async () => {
    const resolved = await resolveRepos({
      question: "How is OpenClaw able to sync Codex credentials?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual(["openclaw/openclaw"]);
  });

  it("infers vercel-labs/json-render from project-name discovery", async () => {
    const resolved = await resolveRepos({
      question: "How do I get started with json-render?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual([
      "vercel-labs/json-render",
    ]);
  });

  it("infers badlogic/pi-mono from package metadata", async () => {
    const resolved = await resolveRepos({
      question: "How does the pi-ai package implement openai codex oauth?",
    });

    expect(resolved.map((entry) => entry.repo)).toEqual(["badlogic/pi-mono"]);
  });

  it("infers tokio-rs/axum from crate metadata", async () => {
    const resolved = await resolveRepos({
      question: "How do I make a server with the axum library?",
    });

    expect(resolved.map((entry) => entry.repo)).toEqual(["tokio-rs/axum"]);
  });

  it("allows multiple high-confidence sources for cross-source questions", async () => {
    const resolved = await resolveRepos({
      question: "Where does Next take its list of Google fonts from?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual([
      "vercel/next.js",
      "google/fonts",
    ]);
  });

  it("returns an ambiguity error when nothing matches", async () => {
    await expect(
      resolveRepos({
        question: "What repo owns this imaginary library?",
      }),
    ).rejects.toMatchObject({
      code: "REPO_INFERENCE_AMBIGUOUS",
    } satisfies Partial<AppError>);
  });

  it("falls back to non-GitHub discovery when GitHub search returns 403", async () => {
    const fetchMock = installFetchMock();
    (fetchMock as Mock).mockImplementation(async (url: string | URL) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "api.github.com") {
        return new Response("rate limited", { status: 403 });
      }

      if (parsed.hostname === "crates.io") {
        const query = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
        return new Response(JSON.stringify(crateResponses[query] ?? {}), {
          status: crateResponses[query] ? 200 : 404,
          headers: { "content-type": "application/json" },
        });
      }

      if (parsed.hostname === "registry.npmjs.org" && parsed.pathname === "/-/v1/search") {
        const query = parsed.searchParams.get("text") || "";
        return new Response(
          JSON.stringify(npmSearchResponses[query] ?? { objects: [] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });

    const resolved = await resolveRepos({
      question: "How does the pi-ai package implement openai codex oauth?",
    });

    expect(resolved.map((entry) => entry.repo)).toEqual(["badlogic/pi-mono"]);
  });
});
