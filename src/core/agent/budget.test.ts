import { describe, expect, it } from "vitest";
import {
  buildStopExplorationMessage,
  countDistinctFileCitations,
} from "./budget.js";

describe("countDistinctFileCitations", () => {
  it("dedupes files and ignores web citations", () => {
    expect(
      countDistinctFileCitations([
        {
          kind: "file",
          repo: "vercel/next.js",
          commitSha: "abc",
          path: "packages/font/src/google/index.ts",
          startLine: 1,
          endLine: 10,
        },
        {
          kind: "file",
          repo: "vercel/next.js",
          commitSha: "abc",
          path: "packages/font/src/google/index.ts",
          startLine: 20,
          endLine: 40,
        },
        {
          kind: "file",
          repo: "vercel/next.js",
          commitSha: "abc",
          path: "scripts/update-google-fonts.js",
          startLine: 1,
          endLine: 40,
        },
        {
          kind: "web",
          url: "https://example.com",
          title: "Example",
        },
      ]),
    ).toBe(2);
  });
});

describe("buildStopExplorationMessage", () => {
  it("waits until the agent has both enough turns and distinct file evidence", () => {
    expect(
      buildStopExplorationMessage({
        turn: 2,
        maxTurns: 12,
        citations: [
          {
            kind: "file",
            repo: "owner/repo",
            commitSha: "abc",
            path: "a.ts",
            startLine: 1,
            endLine: 5,
          },
          {
            kind: "file",
            repo: "owner/repo",
            commitSha: "abc",
            path: "b.ts",
            startLine: 1,
            endLine: 5,
          },
          {
            kind: "file",
            repo: "owner/repo",
            commitSha: "abc",
            path: "c.ts",
            startLine: 1,
            endLine: 5,
          },
        ],
      }),
    ).toBeNull();

    expect(
      buildStopExplorationMessage({
        turn: 3,
        maxTurns: 12,
        citations: [
          {
            kind: "file",
            repo: "owner/repo",
            commitSha: "abc",
            path: "a.ts",
            startLine: 1,
            endLine: 5,
          },
          {
            kind: "file",
            repo: "owner/repo",
            commitSha: "abc",
            path: "b.ts",
            startLine: 1,
            endLine: 5,
          },
        ],
      }),
    ).toBeNull();
  });

  it("pushes the agent to answer once it has enough file evidence", () => {
    const message = buildStopExplorationMessage({
      turn: 3,
      maxTurns: 12,
      citations: [
        {
          kind: "file",
          repo: "owner/repo",
          commitSha: "abc",
          path: "a.ts",
          startLine: 1,
          endLine: 5,
        },
        {
          kind: "file",
          repo: "owner/repo",
          commitSha: "abc",
          path: "b.ts",
          startLine: 1,
          endLine: 5,
        },
        {
          kind: "file",
          repo: "owner/repo",
          commitSha: "abc",
          path: "c.ts",
          startLine: 1,
          endLine: 5,
        },
      ],
    });

    expect(message).toContain("enough repository evidence");
    expect(message).toContain("3 distinct files");
    expect(message).toContain("Your next response should usually be the final answer");
  });
});
