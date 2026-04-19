import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { AppError, toAppError } from "./errors.js";
import { questionRequestSchema, type QuestionRequest, type QuestionResponse, type RepoInferenceAmbiguous } from "./types.js";
import { resolveRepos } from "./repos/repoResolver.js";
import { prepareRepoHandle } from "./repos/repoCache.js";
import { runAgentQuestion } from "./agent/runner.js";

export async function answerQuestion(rawRequest: unknown, onDelta?: (delta: string) => void): Promise<QuestionResponse> {
  const config = loadConfig();
  const request = questionRequestSchema.parse(rawRequest) as QuestionRequest;
  const refresh = request.refresh ?? "if-stale";

  try {
    const resolvedRepos = await resolveRepos(request);
    const requestId = randomUUID();
    const preparedRepos = await Promise.all(
      resolvedRepos.map(async (repo) => await prepareRepoHandle({ input: repo, config, refresh, requestId })),
    );

    return await runAgentQuestion({
      config,
      request,
      repos: preparedRepos,
      onDelta,
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
