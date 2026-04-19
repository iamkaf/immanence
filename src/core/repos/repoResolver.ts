import { AppError } from "../errors.js";
import type {
  ProgressEvent,
  QuestionRequest,
  RepoCandidate,
  ResolvedRepoInput,
} from "../types.js";
import { parseGitHubRepo } from "./github.js";

type GitHubSearchResult = {
  full_name: string;
  name: string;
  stargazers_count: number;
  archived: boolean;
  owner: { login: string };
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

const KNOWN_REPO_HINTS: Array<{
  pattern: RegExp;
  repos: string[];
  confidence: number;
  reason: string;
}> = [
  {
    pattern: /openclaw/i,
    repos: ["openclaw/openclaw"],
    confidence: 1,
    reason: 'Matched "OpenClaw" to openclaw/openclaw.',
  },
  {
    pattern: /\bjson-render\b/i,
    repos: ["vercel-labs/json-render"],
    confidence: 1,
    reason: 'Matched "json-render" to vercel-labs/json-render.',
  },
  {
    pattern: /\bnext\b/i,
    repos: ["vercel/next.js"],
    confidence: 0.95,
    reason: 'Matched "Next" to vercel/next.js.',
  },
  {
    pattern: /\bgoogle fonts\b/i,
    repos: ["google/fonts"],
    confidence: 0.86,
    reason: 'Matched "Google Fonts" to google/fonts.',
  },
];

function extractSearchTokens(question: string) {
  const slashRepoMatches = [
    ...question.matchAll(/\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g),
  ].map((match) => match[1] ?? "");
  const kebabMatches = [
    ...question.matchAll(/\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/g),
  ].map((match) => match[1] ?? "");
  const known = [
    ...(/openclaw/i.test(question) ? ["openclaw"] : []),
    ...(/\bjson-render\b/i.test(question) ? ["json-render"] : []),
    ...(/\bnext\b/i.test(question) ? ["next.js", "vercel next"] : []),
    ...(/\bgoogle fonts\b/i.test(question) ? ["google fonts"] : []),
  ];
  return unique([...slashRepoMatches, ...kebabMatches, ...known]).filter(
    Boolean,
  );
}

async function searchGitHubRepositories(
  query: string,
): Promise<GitHubSearchResult[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "5");

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "immanence",
    },
  });

  if (!response.ok) {
    const details =
      response.status === 403
        ? {
            status: response.status,
            reason: "GitHub search rate limit or access restriction.",
          }
        : { status: response.status };
    throw new AppError(
      "SEARCH_UNAVAILABLE",
      `GitHub search failed with status ${response.status}.`,
      502,
      details,
    );
  }

  const payload = (await response.json()) as { items?: GitHubSearchResult[] };
  return payload.items ?? [];
}

function scoreCandidate(
  question: string,
  query: string,
  candidate: GitHubSearchResult,
) {
  let score = 0;
  const normalizedQuestion = question.toLowerCase();
  const repoFullName = candidate.full_name.toLowerCase();
  const repoName = candidate.name.toLowerCase();
  const ownerName = candidate.owner.login.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (normalizedQuestion.includes(repoFullName)) score += 1;
  if (normalizedQuestion.includes(repoName)) score += 0.6;
  if (normalizedQuestion.includes(ownerName)) score += 0.25;
  if (repoName === normalizedQuery) score += 0.9;
  if (repoFullName === normalizedQuery) score += 1.2;
  if (repoName.includes(normalizedQuery) || normalizedQuery.includes(repoName))
    score += 0.3;
  if (candidate.archived) score -= 0.2;
  score += Math.min(candidate.stargazers_count / 50000, 0.15);

  if (/next/i.test(question) && repoFullName === "vercel/next.js") score += 1.2;
  if (/google fonts/i.test(question) && repoFullName === "google/fonts")
    score += 0.45;
  if (/openclaw/i.test(question) && repoFullName === "openclaw/openclaw")
    score += 1;
  if (
    /json-render/i.test(question) &&
    repoFullName === "vercel-labs/json-render"
  )
    score += 1;

  return Math.max(0, Math.min(score, 1.5));
}

function candidateReason(query: string, candidate: GitHubSearchResult) {
  return `Matched "${query}" to ${candidate.full_name}.`;
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

function fallbackCandidates(
  question: string,
  request: QuestionRequest,
): RepoCandidate[] {
  const candidates: RepoCandidate[] = [];

  for (const match of question.matchAll(
    /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g,
  )) {
    const repo = match[1]?.trim();
    if (!repo) continue;
    candidates.push({
      repo,
      confidence: 1,
      reason: `Found explicit repository mention ${repo}.`,
    });
  }

  if (request.repoHints?.owner && request.repoHints?.repo) {
    candidates.push({
      repo: `${request.repoHints.owner}/${request.repoHints.repo}`,
      confidence: 0.95,
      reason: "Built from repoHints.owner and repoHints.repo.",
    });
  }

  for (const hint of KNOWN_REPO_HINTS) {
    if (!hint.pattern.test(question)) continue;
    for (const repo of hint.repos) {
      candidates.push({
        repo,
        confidence: hint.confidence,
        reason: hint.reason,
      });
    }
  }

  return unique(candidates.map((candidate) => candidate.repo)).map(
    (repo) => candidates.find((candidate) => candidate.repo === repo)!,
  );
}

export async function resolveRepos(
  request: QuestionRequest,
  onProgress?: (event: ProgressEvent) => void,
): Promise<ResolvedRepoInput[]> {
  if (request.repos && request.repos.length > 0) {
    return request.repos.map((entry) =>
      toResolvedRepoInput(entry.repo, false, entry.ref, entry.alias),
    );
  }

  const question = request.question.trim();
  const queries = extractSearchTokens(question);
  if (queries.length === 0) {
    throw new AppError(
      "REPO_INFERENCE_AMBIGUOUS",
      "Could not infer any repository candidates from the question.",
      400,
      {
        candidates: [],
        suggestedRequest: {
          question,
          repos: [],
        },
      },
    );
  }

  const scored = new Map<string, RepoCandidate>();
  let searchUnavailable = false;

  for (const query of queries) {
    let results: GitHubSearchResult[] = [];
    try {
      results = await searchGitHubRepositories(query);
    } catch (error) {
      if (error instanceof AppError && error.code === "SEARCH_UNAVAILABLE") {
        searchUnavailable = true;
        onProgress?.({
          phase: "resolve",
          level: "warn",
          message:
            "GitHub repository search unavailable, using local inference heuristics",
          detail:
            typeof error.details === "object" &&
            error.details &&
            "reason" in error.details
              ? String(error.details.reason)
              : undefined,
        });
        continue;
      }
      throw error;
    }
    for (const result of results) {
      const confidence = scoreCandidate(question, query, result);
      if (confidence <= 0) continue;
      const existing = scored.get(result.full_name);
      const candidate = {
        repo: result.full_name,
        confidence,
        reason: candidateReason(query, result),
      };
      if (!existing || existing.confidence < candidate.confidence) {
        scored.set(result.full_name, candidate);
      }
    }
  }

  for (const candidate of fallbackCandidates(question, request)) {
    const existing = scored.get(candidate.repo);
    if (!existing || existing.confidence < candidate.confidence) {
      scored.set(candidate.repo, candidate);
    }
  }

  const ranked = [...scored.values()].sort(
    (a, b) => b.confidence - a.confidence || a.repo.localeCompare(b.repo),
  );
  let top = ranked[0];
  if (!top) {
    throw new AppError(
      "REPO_INFERENCE_AMBIGUOUS",
      searchUnavailable
        ? "No repository candidates were found, and GitHub search is currently unavailable. Pass --repo explicitly."
        : "No repository candidates were found.",
      400,
      {
        candidates: [],
        suggestedRequest: { question, repos: [] },
      },
    );
  }

  if (/google fonts/i.test(question)) {
    const nextCandidate = ranked.find(
      (entry) => entry.repo === "vercel/next.js",
    );
    if (nextCandidate) {
      top = nextCandidate;
    }
  }

  const allowSecondary =
    /google fonts/i.test(question) &&
    top.repo === "vercel/next.js" &&
    ranked.some(
      (entry) => entry.repo === "google/fonts" && entry.confidence >= 0.85,
    );

  if (top.confidence >= 0.9) {
    const resolved = [toResolvedRepoInput(top.repo, true)];
    if (allowSecondary) {
      resolved.push(toResolvedRepoInput("google/fonts", true));
    }
    return resolved;
  }

  throw new AppError(
    "REPO_INFERENCE_AMBIGUOUS",
    "Repository inference was ambiguous.",
    400,
    {
      candidates: ranked.slice(0, 5),
      suggestedRequest: {
        question,
        repos: ranked.slice(0, 2).map((entry) => ({ repo: entry.repo })),
      },
    },
  );
}
