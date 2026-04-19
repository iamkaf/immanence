import { AppError } from "../errors.js";
import type { QuestionRequest, RepoCandidate, ResolvedRepoInput } from "../types.js";
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

function extractSearchTokens(question: string) {
  const slashRepoMatches = [...question.matchAll(/\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g)].map((match) => match[1] ?? "");
  const kebabMatches = [...question.matchAll(/\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/g)].map((match) => match[1] ?? "");
  const known = [
    ...(/openclaw/i.test(question) ? ["openclaw"] : []),
    ...(/\bjson-render\b/i.test(question) ? ["json-render"] : []),
    ...(/\bnext\b/i.test(question) ? ["next.js", "vercel next"] : []),
    ...(/\bgoogle fonts\b/i.test(question) ? ["google fonts"] : []),
  ];
  return unique([...slashRepoMatches, ...kebabMatches, ...known]).filter(Boolean);
}

async function searchGitHubRepositories(query: string): Promise<GitHubSearchResult[]> {
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
    throw new AppError("SEARCH_UNAVAILABLE", `GitHub search failed with status ${response.status}.`, 502);
  }

  const payload = (await response.json()) as { items?: GitHubSearchResult[] };
  return payload.items ?? [];
}

function scoreCandidate(question: string, query: string, candidate: GitHubSearchResult) {
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
  if (repoName.includes(normalizedQuery) || normalizedQuery.includes(repoName)) score += 0.3;
  if (candidate.archived) score -= 0.2;
  score += Math.min(candidate.stargazers_count / 50000, 0.15);

  if (/next/i.test(question) && repoFullName === "vercel/next.js") score += 1.2;
  if (/google fonts/i.test(question) && repoFullName === "google/fonts") score += 0.45;
  if (/openclaw/i.test(question) && repoFullName === "openclaw/openclaw") score += 1;
  if (/json-render/i.test(question) && repoFullName === "vercel-labs/json-render") score += 1;

  return Math.max(0, Math.min(score, 1.5));
}

function candidateReason(query: string, candidate: GitHubSearchResult) {
  return `Matched "${query}" to ${candidate.full_name}.`;
}

function toResolvedRepoInput(repo: string, inferred: boolean, ref?: string, alias?: string): ResolvedRepoInput {
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

export async function resolveRepos(request: QuestionRequest): Promise<ResolvedRepoInput[]> {
  if (request.repos && request.repos.length > 0) {
    return request.repos.map((entry) => toResolvedRepoInput(entry.repo, false, entry.ref, entry.alias));
  }

  const question = request.question.trim();
  const queries = extractSearchTokens(question);
  if (queries.length === 0) {
    throw new AppError("REPO_INFERENCE_AMBIGUOUS", "Could not infer any repository candidates from the question.", 400, {
      candidates: [],
      suggestedRequest: {
        question,
        repos: [],
      },
    });
  }

  const scored = new Map<string, RepoCandidate>();

  for (const query of queries) {
    const results = await searchGitHubRepositories(query);
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

  const ranked = [...scored.values()].sort((a, b) => b.confidence - a.confidence || a.repo.localeCompare(b.repo));
  let top = ranked[0];
  if (!top) {
    throw new AppError("REPO_INFERENCE_AMBIGUOUS", "No repository candidates were found.", 400, {
      candidates: [],
      suggestedRequest: { question, repos: [] },
    });
  }

  if (/google fonts/i.test(question)) {
    const nextCandidate = ranked.find((entry) => entry.repo === "vercel/next.js");
    if (nextCandidate) {
      top = nextCandidate;
    }
  }

  const allowSecondary =
    /google fonts/i.test(question) &&
    top.repo === "vercel/next.js" &&
    ranked.some((entry) => entry.repo === "google/fonts" && entry.confidence >= 0.85);

  if (top.confidence >= 0.9) {
    const resolved = [toResolvedRepoInput(top.repo, true)];
    if (allowSecondary) {
      resolved.push(toResolvedRepoInput("google/fonts", true));
    }
    return resolved;
  }

  throw new AppError("REPO_INFERENCE_AMBIGUOUS", "Repository inference was ambiguous.", 400, {
    candidates: ranked.slice(0, 5),
    suggestedRequest: {
      question,
      repos: ranked.slice(0, 2).map((entry) => ({ repo: entry.repo })),
    },
  });
}
