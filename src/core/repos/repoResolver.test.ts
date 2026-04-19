import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { resolveRepos } from "./repoResolver.js";

describe("resolveRepos", () => {
  it("passes through explicit repos", async () => {
    const resolved = await resolveRepos({
      question: "How is OpenClaw able to sync Codex credentials?",
      repos: [{ repo: "openclaw/openclaw" }],
    });

    expect(resolved).toEqual([
      expect.objectContaining({
        repo: "openclaw/openclaw",
        inferred: false,
      }),
    ]);
  });

  it("uses explicit repo mentions in the question as scope", async () => {
    const resolved = await resolveRepos({
      question: "What are the top 10 recipes in the grandma/cooking-book repo?",
    });

    expect(resolved.map((entry) => entry.repo)).toEqual([
      "grandma/cooking-book",
    ]);
  });

  it("uses the model's guessed repositories", async () => {
    const resolved = await resolveRepos(
      {
        question: "Where does Next take its list of Google fonts from?",
      },
      {
        plannerHints: {
          explicitRepos: ["vercel/next.js", "https://github.com/google/fonts"],
          primarySubjects: [],
          secondarySubjects: [],
          packageIdentifiers: [],
          repoQueries: [],
          likelyPaths: [],
          crossSource: true,
        },
      },
    );

    expect(resolved.map((entry) => entry.repo)).toEqual([
      "vercel/next.js",
      "google/fonts",
    ]);
  });

  it("fails closed when the model does not guess a repository", async () => {
    await expect(
      resolveRepos(
        {
          question: "What repo owns this imaginary library?",
        },
        {
          plannerHints: {
            explicitRepos: [],
            primarySubjects: [],
            secondarySubjects: [],
            packageIdentifiers: [],
            repoQueries: [],
            likelyPaths: [],
            crossSource: false,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "REPO_INFERENCE_AMBIGUOUS",
      message:
        "The model did not produce a repository guess. Pass --repo explicitly.",
    } satisfies Partial<AppError>);
  });
});
