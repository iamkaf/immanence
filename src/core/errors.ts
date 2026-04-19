export type ErrorCode =
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

  constructor(code: ErrorCode, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) return error;
  if (typeof error === "object" && error && "name" in error && error.name === "ZodError") {
    return new AppError("INVALID_REQUEST", "Request validation failed.", 400, error);
  }
  if (error instanceof Error) {
    return new AppError("MODEL_ERROR", error.message, 500);
  }
  return new AppError("MODEL_ERROR", "Unknown error.", 500);
}
