import { AppError } from "../errors.js";
import type {
  ProgressEvent,
  QuestionRequest,
  RepoCandidate,
  ResolvedRepoInput,
} from "../types.js";
import { parseGitHubRepo } from "./github.js";
import type { SourceDiscoveryPlan } from "./sourcePlanner.js";

type GitHubSearchResult = {
  full_name: string;
  name: string;
  stargazers_count: number;
  archived: boolean;
  owner: { login: string };
};

type NpmSearchResult = {
  package: {
    name: string;
    links?: {
      repository?: string;
      homepage?: string;
    };
  };
};

type CratesIoResult = {
  crate?: {
    id: string;
    repository?: string | null;
    homepage?: string | null;
  };
};

type PypiResult = {
  info?: {
    name?: string;
    home_page?: string | null;
    project_urls?: Record<string, string> | null;
  };
};

type NpmPackageMetadata = {
  name?: string;
  repository?: string | { url?: string };
  homepage?: string;
};

type QuestionContext = {
  normalizedQuestion: string;
  packageContext: boolean;
  crateContext: boolean;
  pythonContext: boolean;
  crossSourceContext: boolean;
};

type DiscoveryCandidate = {
  repo: string;
  confidence: number;
  reason: string;
  provider: string;
  signal: string;
  strong: boolean;
};

type CandidateBucket = {
  repo: string;
  confidence: number;
  reason: string;
  providers: Set<string>;
  signals: Set<string>;
  strong: boolean;
};

const DISCOVERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "does",
  "for",
  "from",
  "get",
  "how",
  "i",
  "in",
  "is",
  "its",
  "library",
  "list",
  "make",
  "of",
  "package",
  "repo",
  "repository",
  "server",
  "take",
  "the",
  "their",
  "to",
  "top",
  "what",
  "where",
  "with",
]);

function unique<T>(values: Iterable<T>) {
  return [...new Set(values)];
}

function buildQuestionContext(question: string): QuestionContext {
  const normalizedQuestion = question.toLowerCase();
  return {
    normalizedQuestion,
    packageContext: /\b(package|library|module|framework|sdk)\b/i.test(question),
    crateContext: /\b(crate|cargo|rust)\b/i.test(question),
    pythonContext: /\b(python|pypi|pip)\b/i.test(question),
    crossSourceContext:
      /\b(from|with|using|sync(?:ing)?|compare|between|versus|vs\.?|and)\b/i.test(
        question,
      ),
  };
}

function extractExplicitRepoMentions(question: string) {
  return unique(
    [...question.matchAll(/(?<!@)\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\b/g)].map(
      (match) => match[1] ?? "",
    ),
  ).filter(Boolean);
}

function extractContextualIdentifiers(question: string) {
  return unique(
    [
      ...question.matchAll(
        /\b(?:with|using|use|for|from|in|about)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9_.+-]{1,})\s+(?:library|package|crate|module|framework|sdk)\b/g,
      ),
    ].map((match) => match[1] ?? ""),
  ).filter(Boolean);
}

function extractSubjectIdentifiers(question: string) {
  return unique(
    [
      ...question.matchAll(
        /\b(?:how|what|where|why)\s+does\s+([A-Za-z][A-Za-z0-9_.+-]{1,})\b/g,
      ),
      ...question.matchAll(
        /\b(?:how|what|where|why)\s+is\s+([A-Za-z][A-Za-z0-9_.+-]{1,})\b/g,
      ),
    ].map((match) => match[1] ?? ""),
  )
    .filter(Boolean)
    .filter((token) => !DISCOVERY_STOP_WORDS.has(token.toLowerCase()));
}

function extractScopedPackageIdentifiers(question: string) {
  return unique(
    [
      ...question.matchAll(/(^|[^\w/])(@[a-z0-9_.-]+\/[a-z0-9_.-]+)/gi),
    ].map((match) => match[2] ?? ""),
  ).filter(Boolean);
}

function extractKebabIdentifiers(question: string) {
  return unique(
    [...question.matchAll(/\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/g)].map(
      (match) => match[1] ?? "",
    ),
  ).filter(Boolean);
}

function extractProjectTokens(question: string) {
  return unique(
    [
      ...question.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g),
      ...question.matchAll(/\b([A-Z][a-z0-9]{2,})\b/g),
    ].map((match) => match[1] ?? ""),
  )
    .filter(Boolean)
    .filter((token) => !DISCOVERY_STOP_WORDS.has(token.toLowerCase()));
}

function extractQueryBigrams(question: string) {
  const words = (question.toLowerCase().match(/[a-z0-9][a-z0-9.+_-]*/g) ?? []).filter(
    (word) => !DISCOVERY_STOP_WORDS.has(word),
  );
  const bigrams: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index];
    const right = words[index + 1];
    if (!left || !right) continue;
    bigrams.push(`${left} ${right}`);
  }
  return unique(bigrams);
}

function extractPackageIdentifiers(question: string) {
  return unique([
    ...extractScopedPackageIdentifiers(question),
    ...extractKebabIdentifiers(question),
    ...extractContextualIdentifiers(question),
    ...extractSubjectIdentifiers(question),
  ]);
}

function isLikelyPackageIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if ((trimmed.match(/\//g) ?? []).length > 1) return false;
  return /^@?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(trimmed);
}

function normalizePackageIdentifier(value: string) {
  return value.trim().toLowerCase();
}

function extractGitHubQueries(question: string) {
  return unique([
    ...extractExplicitRepoMentions(question),
    ...extractProjectTokens(question),
    ...extractKebabIdentifiers(question),
    ...extractContextualIdentifiers(question),
    ...extractQueryBigrams(question),
  ]).filter(Boolean);
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

async function searchNpmPackages(query: string): Promise<NpmSearchResult[]> {
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.searchParams.set("text", query);
  url.searchParams.set("size", "10");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "immanence",
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { objects?: NpmSearchResult[] };
  return payload.objects ?? [];
}

async function fetchNpmPackageMetadata(
  query: string,
): Promise<NpmPackageMetadata | null> {
  const url = new URL(
    `https://registry.npmjs.org/${encodeURIComponent(normalizePackageIdentifier(query))}`,
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "immanence",
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as NpmPackageMetadata;
}

async function fetchCrateMetadata(query: string): Promise<CratesIoResult | null> {
  const url = new URL(`https://crates.io/api/v1/crates/${encodeURIComponent(query)}`);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "immanence",
    },
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as CratesIoResult;
}

async function fetchPypiMetadata(query: string): Promise<PypiResult | null> {
  const url = new URL(`https://pypi.org/pypi/${encodeURIComponent(query)}/json`);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "immanence",
    },
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as PypiResult;
}

function extractGitHubRepoFromUrl(input?: string | null) {
  if (!input) return null;
  const normalized = input
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/i, "");
  const match = normalized.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#]+)$/i,
  );
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function extractGitHubRepoFromNpmRepository(
  repository?: string | { url?: string },
) {
  if (typeof repository === "string") {
    return extractGitHubRepoFromUrl(repository);
  }
  return extractGitHubRepoFromUrl(repository?.url);
}

function scoreGitHubCandidate(
  context: QuestionContext,
  query: string,
  candidate: GitHubSearchResult,
) {
  let score = 0;
  const repoFullName = candidate.full_name.toLowerCase();
  const repoName = candidate.name.toLowerCase();
  const ownerName = candidate.owner.login.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);

  if (context.normalizedQuestion.includes(repoFullName)) score += 1.2;
  if (context.normalizedQuestion.includes(repoName)) score += 0.55;
  if (context.normalizedQuestion.includes(ownerName)) score += 0.25;
  if (repoName === normalizedQuery) score += 0.85;
  if (repoFullName === normalizedQuery) score += 1.3;
  if (
    queryTerms.length >= 2 &&
    queryTerms.includes(ownerName) &&
    queryTerms.includes(repoName)
  ) {
    score += 0.95;
  }
  if (queryTerms.length >= 2 && repoFullName === queryTerms.join("/")) {
    score += 1.15;
  }
  if (queryTerms.includes(ownerName)) score += 0.2;
  if (queryTerms.includes(repoName)) score += 0.2;
  if (repoName.includes(normalizedQuery) || normalizedQuery.includes(repoName)) {
    score += 0.25;
  }
  if (candidate.archived) score -= 0.2;
  score += Math.min(candidate.stargazers_count / 50000, 0.15);

  return Math.max(0, Math.min(score, 1.5));
}

function scoreNpmCandidate(
  context: QuestionContext,
  query: string,
  candidate: NpmSearchResult,
) {
  const packageName = candidate.package.name.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const unscopedName = packageName.split("/").at(-1) ?? packageName;
  const repository = extractGitHubRepoFromUrl(
    candidate.package.links?.repository,
  );
  const homepage = extractGitHubRepoFromUrl(candidate.package.links?.homepage);

  let score = 0;
  if (packageName === normalizedQuery) score += 0.75;
  if (packageName.endsWith(`/${normalizedQuery}`)) score += 0.95;
  if (unscopedName === normalizedQuery) score += 0.35;
  if (context.normalizedQuestion.includes(packageName)) score += 1.1;
  if (context.normalizedQuestion.includes(unscopedName)) score += 0.15;
  if (context.packageContext) score += 0.15;
  if (repository) score += 0.25;
  if (homepage) score += 0.1;
  if (!repository && !homepage) score -= 0.6;

  return Math.max(0, Math.min(score, 1.5));
}

function scoreExactNpmCandidate(
  context: QuestionContext,
  query: string,
  packageName: string,
) {
  const normalizedQuery = normalizePackageIdentifier(query);
  const normalizedPackage = packageName.toLowerCase();
  const unscopedName = normalizedPackage.split("/").at(-1) ?? normalizedPackage;

  let score = 0.85;
  if (normalizedPackage === normalizedQuery) score += 0.3;
  if (normalizedPackage.endsWith(`/${normalizedQuery}`)) score += 0.35;
  if (context.normalizedQuestion.includes(normalizedPackage)) score += 0.25;
  if (context.normalizedQuestion.includes(unscopedName)) score += 0.1;
  if (context.packageContext) score += 0.1;

  return Math.max(0, Math.min(score, 1.5));
}

function scoreCrateCandidate(context: QuestionContext, query: string) {
  let score = 0.8;
  if (context.crateContext) score += 0.2;
  if (context.packageContext) score += 0.1;
  if (context.normalizedQuestion.includes(query.toLowerCase())) score += 0.2;
  return Math.max(0, Math.min(score, 1.5));
}

function scorePypiCandidate(context: QuestionContext, query: string) {
  let score = 0.7;
  if (context.pythonContext) score += 0.25;
  if (context.packageContext) score += 0.1;
  if (context.normalizedQuestion.includes(query.toLowerCase())) score += 0.2;
  return Math.max(0, Math.min(score, 1.5));
}

function candidateReason(query: string, candidate: GitHubSearchResult) {
  return `Matched ${JSON.stringify(query)} to ${candidate.full_name} via GitHub repository search.`;
}

function npmCandidateReason(
  query: string,
  candidate: NpmSearchResult,
  repo: string,
) {
  return `Matched npm package ${JSON.stringify(query)} to ${candidate.package.name}, which links to ${repo}.`;
}

function crateCandidateReason(query: string, repo: string) {
  return `Matched crate ${JSON.stringify(query)} to ${repo} via crates.io metadata.`;
}

function pypiCandidateReason(query: string, repo: string) {
  return `Matched package ${JSON.stringify(query)} to ${repo} via PyPI metadata.`;
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

function mergeConfidence(previous: number, next: number) {
  return Math.min(1.5, previous + next * 0.65);
}

function addCandidate(
  buckets: Map<string, CandidateBucket>,
  candidate: DiscoveryCandidate,
) {
  const existing = buckets.get(candidate.repo);
  if (!existing) {
    buckets.set(candidate.repo, {
      repo: candidate.repo,
      confidence: candidate.confidence,
      reason: candidate.reason,
      providers: new Set([candidate.provider]),
      signals: new Set([candidate.signal]),
      strong: candidate.strong,
    });
    return;
  }

  existing.confidence = mergeConfidence(existing.confidence, candidate.confidence);
  existing.providers.add(candidate.provider);
  existing.signals.add(candidate.signal);
  existing.strong = existing.strong || candidate.strong;
  if (candidate.confidence >= existing.confidence || !existing.reason) {
    existing.reason = candidate.reason;
  }
}

function fallbackCandidates(
  question: string,
  request: QuestionRequest,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const repo of extractExplicitRepoMentions(question)) {
    candidates.push({
      repo,
      confidence: 1.5,
      reason: `Found explicit repository mention ${repo}.`,
      provider: "explicit_question_scope",
      signal: repo,
      strong: true,
    });
  }

  if (request.repoHints?.owner && request.repoHints?.repo) {
    const repo = `${request.repoHints.owner}/${request.repoHints.repo}`;
    candidates.push({
      repo,
      confidence: 1.35,
      reason: "Built from repoHints.owner and repoHints.repo.",
      provider: "request_repo_hints",
      signal: repo,
      strong: true,
    });
  }

  return candidates;
}

async function discoverRegistryCandidates(
  question: string,
  plannerHints?: SourceDiscoveryPlan | null,
): Promise<DiscoveryCandidate[]> {
  const context = buildQuestionContext(question);
  const identifiers = unique([
    ...(plannerHints?.packageIdentifiers ?? []),
    ...extractPackageIdentifiers(question),
  ])
    .filter(isLikelyPackageIdentifier)
    .map(normalizePackageIdentifier);
  const candidates: DiscoveryCandidate[] = [];

  for (const identifier of identifiers) {
    const exactNpm = await fetchNpmPackageMetadata(identifier);
    const exactRepo =
      extractGitHubRepoFromNpmRepository(exactNpm?.repository) ??
      extractGitHubRepoFromUrl(exactNpm?.homepage);
    if (exactRepo && exactNpm?.name) {
      candidates.push({
        repo: exactRepo,
        confidence: scoreExactNpmCandidate(context, identifier, exactNpm.name),
        reason: `Matched npm package ${JSON.stringify(identifier)} to ${exactNpm.name}, which links to ${exactRepo}.`,
        provider: "npm_registry_exact",
        signal: identifier,
        strong: true,
      });
    }

    if (!identifier.includes("-") && !identifier.startsWith("@")) {
      continue;
    }

    const npmResults = await searchNpmPackages(identifier);
    for (const result of npmResults) {
      const repo =
        extractGitHubRepoFromUrl(result.package.links?.repository) ??
        extractGitHubRepoFromUrl(result.package.links?.homepage);
      if (!repo) continue;
      const confidence = scoreNpmCandidate(context, identifier, result);
      if (confidence <= 0) continue;
      candidates.push({
        repo,
        confidence,
        reason: npmCandidateReason(identifier, result, repo),
        provider: "npm_registry_search",
        signal: identifier.toLowerCase(),
        strong: false,
      });
    }

    const crate = await fetchCrateMetadata(identifier);
    const crateRepo =
      extractGitHubRepoFromUrl(crate?.crate?.repository) ??
      extractGitHubRepoFromUrl(crate?.crate?.homepage);
    if (crateRepo) {
      candidates.push({
        repo: crateRepo,
        confidence: scoreCrateCandidate(context, identifier),
        reason: crateCandidateReason(identifier, crateRepo),
        provider: "crates_io",
        signal: identifier.toLowerCase(),
        strong: true,
      });
    }

    const pypi = await fetchPypiMetadata(identifier);
    const pypiRepo =
      extractGitHubRepoFromUrl(
        pypi?.info?.project_urls?.Source ??
          pypi?.info?.project_urls?.Homepage ??
          pypi?.info?.home_page,
      ) ?? null;
    if (pypiRepo) {
      candidates.push({
        repo: pypiRepo,
        confidence: scorePypiCandidate(context, identifier),
        reason: pypiCandidateReason(identifier, pypiRepo),
        provider: "pypi",
        signal: identifier.toLowerCase(),
        strong: true,
      });
    }
  }

  return candidates;
}

async function discoverGitHubCandidates(
  question: string,
  plannerHints?: SourceDiscoveryPlan | null,
  onProgress?: (event: ProgressEvent) => void,
): Promise<{ candidates: DiscoveryCandidate[]; searchUnavailable: boolean }> {
  const context = buildQuestionContext(question);
  const queries = unique([
    ...(plannerHints?.repoQueries ?? []),
    ...(plannerHints?.primarySubjects ?? []),
    ...(plannerHints?.secondarySubjects ?? []),
    ...extractGitHubQueries(question),
  ]);
  const candidates: DiscoveryCandidate[] = [];
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
            "GitHub repository search unavailable, continuing with other discovery sources",
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
      const confidence = scoreGitHubCandidate(context, query, result);
      if (confidence <= 0) continue;
      candidates.push({
        repo: result.full_name,
        confidence,
        reason: candidateReason(query, result),
        provider: "github_repo_search",
        signal: query.toLowerCase(),
        strong: false,
      });
    }
  }

  return { candidates, searchUnavailable };
}

function rankCandidates(candidates: DiscoveryCandidate[]): RepoCandidate[] {
  const buckets = new Map<string, CandidateBucket>();
  for (const candidate of candidates) {
    addCandidate(buckets, candidate);
  }
  return [...buckets.values()]
    .sort((left, right) => {
      if (left.strong !== right.strong) {
        return left.strong ? -1 : 1;
      }
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return left.repo.localeCompare(right.repo);
    })
    .map((candidate) => ({
      repo: candidate.repo,
      confidence: Number(candidate.confidence.toFixed(4)),
      reason: candidate.strong
        ? candidate.reason
        : `${candidate.reason} Search evidence only.`,
    }));
}

function shouldIncludeSecondary(
  question: string,
  ranked: RepoCandidate[],
  plannerHints?: SourceDiscoveryPlan | null,
) {
  const [top, second] = ranked;
  if (!top || !second) return false;
  if (top.confidence < 0.9 || second.confidence < 0.85) return false;
  return (
    !!plannerHints?.crossSource || buildQuestionContext(question).crossSourceContext
  );
}

function hasStrongEvidence(candidate: RepoCandidate) {
  return !candidate.reason.endsWith("Search evidence only.");
}

export async function resolveRepos(
  request: QuestionRequest,
  options: {
    onProgress?: (event: ProgressEvent) => void;
    plannerHints?: SourceDiscoveryPlan | null;
  } = {},
): Promise<ResolvedRepoInput[]> {
  if (request.repos && request.repos.length > 0) {
    return request.repos.map((entry) =>
      toResolvedRepoInput(entry.repo, false, entry.ref, entry.alias),
    );
  }

  const question = request.question.trim();
  const seededCandidates = fallbackCandidates(question, request);
  const plannerHints = options.plannerHints;

  if (plannerHints?.explicitRepos?.length) {
    return plannerHints.explicitRepos.map((repo) => toResolvedRepoInput(repo, true));
  }

  if (seededCandidates.some((candidate) => candidate.provider === "explicit_question_scope")) {
    return seededCandidates.map((candidate) => toResolvedRepoInput(candidate.repo, true));
  }

  const registryCandidates = await discoverRegistryCandidates(question, plannerHints);
  const { candidates: githubCandidates, searchUnavailable } =
    await discoverGitHubCandidates(question, plannerHints, options.onProgress);

  const ranked = rankCandidates([
    ...seededCandidates,
    ...registryCandidates,
    ...githubCandidates,
  ]);

  const top = ranked[0];
  if (!top) {
    throw new AppError(
      "REPO_INFERENCE_AMBIGUOUS",
      searchUnavailable
        ? "No source candidates were found, and GitHub search is currently unavailable. Pass --repo explicitly."
        : "Could not infer any source candidates from the question.",
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

  if (top.confidence >= 0.9) {
    if (!hasStrongEvidence(top)) {
      throw new AppError(
        "REPO_INFERENCE_AMBIGUOUS",
        "Source discovery produced only weak search evidence.",
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

    const resolved = [toResolvedRepoInput(top.repo, true)];
    if (
      shouldIncludeSecondary(question, ranked, plannerHints) &&
      hasStrongEvidence(ranked[1]!)
    ) {
      resolved.push(toResolvedRepoInput(ranked[1]!.repo, true));
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
