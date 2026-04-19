import { describe, expect, it } from "vitest";
import { AppError, stringifyAppError, toAppErrorPayload } from "./errors.js";

describe("toAppErrorPayload", () => {
  it("spreads ambiguous repo details into the top-level error payload", () => {
    const error = new AppError(
      "REPO_INFERENCE_AMBIGUOUS",
      "Need a repo.",
      400,
      {
        candidates: [{ repo: "owner/repo", confidence: 0.9, reason: "guess" }],
        suggestedRequest: {
          question: "q",
          repos: [{ repo: "owner/repo" }],
        },
      },
    );

    expect(toAppErrorPayload(error)).toEqual({
      error: {
        code: "REPO_INFERENCE_AMBIGUOUS",
        message: "Need a repo.",
        candidates: [{ repo: "owner/repo", confidence: 0.9, reason: "guess" }],
        suggestedRequest: {
          question: "q",
          repos: [{ repo: "owner/repo" }],
        },
      },
    });
  });

  it("keeps other app errors wrapped under details", () => {
    const error = new AppError("INVALID_REQUEST", "Bad input.", 400, {
      field: "question",
    });

    expect(toAppErrorPayload(error)).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Bad input.",
        details: { field: "question" },
      },
    });
    expect(stringifyAppError(error)).toContain('"details": {');
  });
});
