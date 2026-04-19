import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors.js";
import { resolveRepos } from "./repoResolver.js";

const responses: Record<string, unknown> = {
  openclaw: {
    items: [
      { full_name: "openclaw/openclaw", name: "openclaw", stargazers_count: 1200, archived: false, owner: { login: "openclaw" } },
    ],
  },
  "json-render": {
    items: [
      { full_name: "vercel-labs/json-render", name: "json-render", stargazers_count: 500, archived: false, owner: { login: "vercel-labs" } },
    ],
  },
  "next.js": {
    items: [
      { full_name: "vercel/next.js", name: "next.js", stargazers_count: 130000, archived: false, owner: { login: "vercel" } },
    ],
  },
  "vercel next": {
    items: [
      { full_name: "vercel/next.js", name: "next.js", stargazers_count: 130000, archived: false, owner: { login: "vercel" } },
    ],
  },
  "google fonts": {
    items: [
      { full_name: "google/fonts", name: "fonts", stargazers_count: 10000, archived: false, owner: { login: "google" } },
    ],
  },
};

describe("resolveRepos", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const query = new URL(String(url)).searchParams.get("q") || "";
        return new Response(JSON.stringify(responses[query] ?? { items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  it("passes through explicit repos", async () => {
    const resolved = await resolveRepos({
      question: "How is OpenClaw able to sync Codex credentials?",
      repos: [{ repo: "openclaw/openclaw" }],
    });
    expect(resolved[0]?.repo).toBe("openclaw/openclaw");
    expect(resolved[0]?.inferred).toBe(false);
  });

  it("infers openclaw/openclaw", async () => {
    const resolved = await resolveRepos({
      question: "How is OpenClaw able to sync Codex credentials?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual(["openclaw/openclaw"]);
  });

  it("infers vercel-labs/json-render", async () => {
    const resolved = await resolveRepos({
      question: "How do I get started with json-render?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual(["vercel-labs/json-render"]);
  });

  it("allows google/fonts as a secondary repo for the Next prompt", async () => {
    const resolved = await resolveRepos({
      question: "Where does Next take its list of Google fonts from?",
    });
    expect(resolved.map((entry) => entry.repo)).toEqual(["vercel/next.js", "google/fonts"]);
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
});
