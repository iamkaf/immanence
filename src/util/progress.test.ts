import { describe, expect, it } from "vitest";
import type { ProgressEvent } from "../core/types.js";
import { shouldDisplayProgressEvent } from "./progress.js";

function event(overrides: Partial<ProgressEvent>): ProgressEvent {
  return {
    phase: "agent",
    message: "turn 1: sending request",
    ...overrides,
  };
}

describe("shouldDisplayProgressEvent", () => {
  it("keeps high-signal progress events", () => {
    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "resolve",
          message: "resolved repositories",
          detail: "honojs/hono",
        }),
      ),
    ).toBe(true);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "agent",
          message: "turn 3: sending request",
        }),
      ),
    ).toBe(true);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "agent",
          tool: "read",
          path: "src/router.ts",
          message: "requested tool",
        }),
      ),
    ).toBe(true);
  });

  it("hides low-value lifecycle chatter", () => {
    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "request",
          message: "validated request",
        }),
      ),
    ).toBe(false);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "auth",
          message: "resolving API key",
        }),
      ),
    ).toBe(false);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "agent",
          message: "using model",
          detail: "gpt-5.3-codex-spark",
        }),
      ),
    ).toBe(false);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "tool",
          tool: "read",
          message: "executing",
        }),
      ),
    ).toBe(false);
  });

  it("hides speculative path misses but keeps meaningful failures", () => {
    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "tool",
          tool: "read",
          level: "error",
          message: "failed",
          detail: "PATH_NOT_FOUND",
        }),
      ),
    ).toBe(false);

    expect(
      shouldDisplayProgressEvent(
        event({
          phase: "tool",
          tool: "read",
          level: "error",
          message: "failed",
          detail: "SEARCH_UNAVAILABLE",
        }),
      ),
    ).toBe(true);
  });
});
