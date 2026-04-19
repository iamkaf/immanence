import { loadConfig } from "./config.js";
import { toAppError } from "./errors.js";
import {
  questionRequestSchema,
  type ProgressEvent,
  type QuestionResponse,
} from "./types.js";
import { resolveRepos } from "./repos/repoResolver.js";
import { planSourcesWithAi } from "./repos/sourcePlanner.js";
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

  try {
    const request = questionRequestSchema.parse(rawRequest);
    const refresh = request.refresh ?? "if-stale";
    hooks.onProgress?.({ phase: "request", message: "validated request" });
    hooks.onProgress?.({ phase: "resolve", message: "planning sources" });
    const plannerHints =
      request.repos && request.repos.length > 0
        ? null
        : await planSourcesWithAi({
            config,
            question: request.question,
            modelOverride: request.model,
          });
    if (plannerHints) {
      hooks.onProgress?.({
        phase: "resolve",
        message: "source plan ready",
        detail: [
          ...plannerHints.primarySubjects,
          ...plannerHints.secondarySubjects,
          ...plannerHints.explicitRepos,
        ].join(", "),
      });
    }
    const resolvedRepos = await resolveRepos(request, { plannerHints });
    hooks.onProgress?.({
      phase: "resolve",
      message: "resolved repositories",
      detail: resolvedRepos.map((repo) => repo.repo).join(", "),
    });
    const preparedRepos = await Promise.all(
      resolvedRepos.map(
        async (repo) =>
          await prepareRepoHandle({
            input: repo,
            config,
            refresh,
            onProgress: hooks.onProgress,
          }),
      ),
    );
    hooks.onProgress?.({ phase: "agent", message: "starting agent" });

    return await runAgentQuestion({
      config,
      request,
      repos: preparedRepos,
      plannerHints,
      onDelta: hooks.onDelta,
      onProgress: hooks.onProgress,
    });
  } catch (error) {
    throw toAppError(error);
  }
}
