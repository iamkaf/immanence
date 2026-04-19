import { ZodError } from "zod";
import type { RepoInferenceAmbiguous } from "./types.js";
import { stableStringify } from "../util/json.js";

type ErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "REPO_NOT_FOUND"
  | "REF_NOT_FOUND"
  | "CLONE_FAILED"
  | "REPO_INFERENCE_AMBIGUOUS"
  | "SEARCH_UNAVAILABLE"
  | "FILE_NOT_TEXT"
  | "PATH_NOT_FOUND"
  | "TOOL_LIMIT_EXCEEDED"
  | "AGENT_TIMEOUT"
  | "MODEL_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 400,
    details?: unknown,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type AppErrorPayload = {
  error:
    | RepoInferenceAmbiguous["error"]
    | {
        code: ErrorCode;
        message: string;
        details?: unknown;
      };
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toAppErrorPayload(error: AppError): AppErrorPayload {
  if (error.code === "REPO_INFERENCE_AMBIGUOUS") {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(isObjectRecord(error.details) ? error.details : {}),
      },
    };
  }

  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

export function stringifyAppError(error: AppError) {
  return stableStringify(toAppErrorPayload(error));
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(
      "INVALID_REQUEST",
      "Request validation failed.",
      400,
      error,
    );
  }
  if (error instanceof Error) {
    return new AppError("MODEL_ERROR", error.message, 500);
  }
  return new AppError("MODEL_ERROR", "Unknown error.", 500);
}
