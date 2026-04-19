import { answerQuestion } from "../../core/service.js";
import { AppError, stringifyAppError } from "../../core/errors.js";
import type { RefreshMode } from "../../core/types.js";
import {
  formatProgressEvent,
  shouldDisplayProgressEvent,
} from "../../util/progress.js";
import { writeJson } from "./shared.js";

export async function askCommand(options: {
  question: string;
  repos?: string[];
  ref?: string;
  model?: string;
  includeWebSearch?: boolean;
  refresh?: RefreshMode;
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
      {
        onProgress: (event) => {
          if (!options.json && shouldDisplayProgressEvent(event))
            process.stderr.write(`${formatProgressEvent(event)}\n`);
        },
      },
    );
    if (options.json) {
      writeJson(response);
    } else {
      process.stdout.write(`${response.answer}\n`);
    }
  } catch (error) {
    if (error instanceof AppError) {
      process.stdout.write(`${stringifyAppError(error)}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
