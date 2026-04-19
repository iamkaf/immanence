import { streamSimple, type Message } from "@mariozechner/pi-ai";
import type { ImmanenceConfig } from "../config.js";
import {
  sourceDiscoveryPlanSchema,
  type SourceDiscoveryPlan,
} from "../types.js";
import { resolveCodexApiKey, resolveCodexModel } from "../auth/codexAuth.js";
import { assistantText } from "../../util/piAi.js";

const EMPTY_PLAN: SourceDiscoveryPlan = sourceDiscoveryPlanSchema.parse({});

function parsePlannerJson(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return sourceDiscoveryPlanSchema.parse(
    JSON.parse((fenced?.[1] ?? raw).trim()),
  );
}

export async function planSourcesWithAi(args: {
  config: ImmanenceConfig;
  question: string;
  modelOverride?: string;
}): Promise<SourceDiscoveryPlan | null> {
  try {
    const model = await resolveCodexModel(
      args.modelOverride ?? args.config.defaultModel,
    );
    if (!model) return null;
    const apiKey = await resolveCodexApiKey(args.config.authFilePath);
    const messages: Message[] = [
      {
        role: "user",
        content: args.question,
        timestamp: Date.now(),
      },
    ];

    const stream = streamSimple(
      model,
      {
        systemPrompt: [
          "You plan source discovery for a code exploration assistant.",
          "Return JSON only.",
          "Use explicitRepos for the best-guess public GitHub repositories that should be inspected.",
          "Even if the user did not name a repository, you should still guess likely owner/name repositories when the subject is recognizable.",
          "Prefer canonical upstream repositories over mirrors, demos, forks, or adjacent ecosystem repos.",
          "Put the most likely repository first and keep explicitRepos short.",
          "Extract the main subject and any secondary source subjects that the assistant may need to inspect.",
          "Prefer package, crate, or module identifiers when they are likely canonical.",
          "Use likelyPaths for 1-5 high-confidence file paths, modules, or directories the assistant should inspect first.",
          "Prefer exact source files or generator scripts over broad directories when you can infer them.",
          "When you are not confident about an exact filename, prefer a stable existing-looking directory or module path instead of inventing a file.",
          "Use repoQueries for short fallback search phrases that may help the assistant if the repo guess is wrong.",
          "Keep arrays short and high-signal.",
          'Schema: {"explicitRepos":[],"primarySubjects":[],"secondarySubjects":[],"packageIdentifiers":[],"repoQueries":[],"likelyPaths":[],"crossSource":false}',
        ].join("\n"),
        messages,
      },
      {
        apiKey,
        maxTokens: 300,
        reasoning: "low",
      },
    );

    const message = await stream.result();
    if (message.stopReason === "aborted" || message.stopReason === "error") {
      return null;
    }

    const parsed = parsePlannerJson(assistantText(message));
    return {
      ...EMPTY_PLAN,
      ...parsed,
    };
  } catch {
    return null;
  }
}
