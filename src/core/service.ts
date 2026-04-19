import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { AppError, toAppError } from "./errors.js";
import {
  questionRequestSchema,
  type ProgressEvent,
  type QuestionRequest,
  type QuestionResponse,
  type RepoInferenceAmbiguous,
} from "./types.js";
import { resolveRepos } from "./repos/repoResolver.js";
import { prepareRepoHandle } from "./repos/repoCache.js";
import { runAgentQuestion } from "./agent/runner.js";

export async function answerQuestion(
  rawRequest: unknown,
  hooks: {
    onDelta?: (delta: string) => void;
    onProgress?: (event: ProgressEvent) => void;
  } = {},
): Promise<QuestionResponse> {
  const config = loadConfig();
  const request = questionRequestSchema.parse(rawRequest) as QuestionRequest;
  const refresh = request.refresh ?? "if-stale";

  try {
    hooks.onProgress?.({ phase: "request", message: "validated request" });
    hooks.onProgress?.({ phase: "resolve", message: "planning sources" });
    const resolvedRepos = await resolveRepos(request, hooks.onProgress);
    hooks.onProgress?.({
      phase: "resolve",
      message: "resolved repositories",
      detail: resolvedRepos.map((repo) => repo.repo).join(", "),
    });
    const requestId = randomUUID();
    const preparedRepos = await Promise.all(
      resolvedRepos.map(
        async (repo) =>
          await prepareRepoHandle({
            input: repo,
            config,
            refresh,
            requestId,
            onProgress: hooks.onProgress,
          }),
      ),
    );
    hooks.onProgress?.({ phase: "agent", message: "starting agent" });

    return await runAgentQuestion({
      config,
      request,
      repos: preparedRepos,
      onDelta: hooks.onDelta,
      onProgress: hooks.onProgress,
    });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === "REPO_INFERENCE_AMBIGUOUS") {
      const details = (appError.details ?? {
        candidates: [],
        suggestedRequest: { question: request.question, repos: [] },
      }) as RepoInferenceAmbiguous["error"];
      throw new AppError(appError.code, appError.message, appError.statusCode, {
        code: "REPO_INFERENCE_AMBIGUOUS",
        message: appError.message,
        candidates: details.candidates,
        suggestedRequest: details.suggestedRequest,
      });
    }
    throw appError;
  }
}
