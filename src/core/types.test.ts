import { describe, expect, it } from "vitest";
import { questionRequestSchema } from "./types.js";

describe("questionRequestSchema", () => {
  it("accepts question-only requests", () => {
    const parsed = questionRequestSchema.parse({
      question: "How is OpenClaw able to sync Codex credentials?",
    });
    expect(parsed.question).toContain("OpenClaw");
  });

  it("rejects too many repos", () => {
    expect(() =>
      questionRequestSchema.parse({
        question: "q",
        repos: Array.from({ length: 6 }, (_, index) => ({
          repo: `owner/repo-${index}`,
        })),
      }),
    ).toThrow();
  });
});
