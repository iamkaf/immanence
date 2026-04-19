import { answerQuestion } from "../../core/service.js";
import { AppError } from "../../core/errors.js";

export async function askCommand(options: {
  question: string;
  repos?: string[];
  ref?: string;
  model?: string;
  includeWebSearch?: boolean;
  refresh?: "never" | "if-stale" | "always";
  maxToolCalls?: number;
  json?: boolean;
}) {
  try {
    const response = await answerQuestion(
      {
        question: options.question,
        repos: options.repos?.map((repo) => ({ repo, ref: options.ref })),
        model: options.model,
        includeWebSearch: options.includeWebSearch,
        refresh: options.refresh,
        maxToolCalls: options.maxToolCalls,
      },
      (delta) => {
        if (!options.json) process.stderr.write(delta);
      },
    );
    if (!options.json) process.stderr.write("\n");
    if (options.json) {
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    } else {
      process.stdout.write(`${response.answer}\n`);
    }
  } catch (error) {
    if (error instanceof AppError) {
      const payload =
        error.code === "REPO_INFERENCE_AMBIGUOUS"
          ? {
              error: {
                code: error.code,
                message: error.message,
                ...(typeof error.details === "object" && error.details ? error.details : {}),
              },
            }
          : {
              error: {
                code: error.code,
                message: error.message,
                details: error.details,
              },
            };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
