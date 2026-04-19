import { AppError } from "../errors.js";
import type {
  ProgressEvent,
  QuestionRequest,
  ResolvedRepoInput,
} from "../types.js";
import { parseGitHubRepo } from "./github.js";
import type { SourceDiscoveryPlan } from "./sourcePlanner.js";

function unique<T>(values: Iterable<T>) {
  return [...new Set(values)];
}

function extractExplicitRepoMentions(question: string) {
  return unique(
    [...question.matchAll(/(?<!@)\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g)].map(
      (match) => match[1] ?? "",
    ),
  ).filter(Boolean);
}

function toResolvedRepoInput(
  repo: string,
  inferred: boolean,
  ref?: string,
  alias?: string,
): ResolvedRepoInput {
  const parsed = parseGitHubRepo(repo);
  return {
    repo: parsed.repo,
    owner: parsed.owner,
    name: parsed.name,
    alias: alias?.trim() || parsed.name,
    ref,
    inferred,
  };
}

function normalizeRepoGuesses(repos: string[], inferred: boolean) {
  const resolved: ResolvedRepoInput[] = [];
  const seen = new Set<string>();

  for (const rawRepo of repos) {
    try {
      const parsed = toResolvedRepoInput(rawRepo, inferred);
      if (seen.has(parsed.repo)) continue;
      seen.add(parsed.repo);
      resolved.push(parsed);
    } catch {
      continue;
    }
  }

  return resolved;
}

export async function resolveRepos(
  request: QuestionRequest,
  options: {
    onProgress?: (event: ProgressEvent) => void;
    plannerHints?: SourceDiscoveryPlan | null;
  } = {},
): Promise<ResolvedRepoInput[]> {
  if (request.repos?.length) {
    return request.repos.map((entry) =>
      toResolvedRepoInput(entry.repo, false, entry.ref, entry.alias),
    );
  }

  const explicitQuestionRepos = normalizeRepoGuesses(
    extractExplicitRepoMentions(request.question.trim()),
    true,
  );
  if (explicitQuestionRepos.length > 0) {
    return explicitQuestionRepos;
  }

  if (request.repoHints?.owner && request.repoHints?.repo) {
    return [
      toResolvedRepoInput(
        `${request.repoHints.owner}/${request.repoHints.repo}`,
        true,
      ),
    ];
  }

  const plannerGuesses = normalizeRepoGuesses(
    options.plannerHints?.explicitRepos ?? [],
    true,
  );
  if (plannerGuesses.length > 0) {
    return plannerGuesses;
  }

  throw new AppError(
    "REPO_INFERENCE_AMBIGUOUS",
    "The model did not produce a repository guess. Pass --repo explicitly.",
    400,
    {
      candidates: [],
      suggestedRequest: {
        question: request.question.trim(),
        repos: [],
      },
    },
  );
}
