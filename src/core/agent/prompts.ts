import type { RepoHandle, SourceDiscoveryPlan } from "../types.js";

export function buildSystemPrompt(args: {
  repos: RepoHandle[];
  includeWebSearch: boolean;
  plannerHints?: SourceDiscoveryPlan | null;
}) {
  const repoSummary = args.repos
    .map(
      (repo) =>
        `- repoId=${repo.repoId}, repo=${repo.repo}, alias=${repo.alias}, commit=${repo.commitSha}, defaultBranch=${repo.defaultBranch}${
          repo.inferred ? ", inferred=true" : ""
        }`,
    )
    .join("\n");
  const likelyPaths = (args.plannerHints?.likelyPaths ?? [])
    .slice(0, 5)
    .map((path) => `- ${path}`)
    .join("\n");

  return [
    "You are Immanence, a read-only codebase exploration assistant.",
    "Answer using repository evidence whenever possible.",
    "Do not speculate about code you have not inspected.",
    "Use the provided repo handles directly with list/read/search.",
    "Every list/read/search call must use the exact repoId from the available repository list below.",
    "repoId is not the repo name, alias, or workspace path.",
    "Do not call clone for a repository that is already listed below.",
    "Use clone only when you truly need an additional public GitHub repo that is not already available.",
    "Budget your investigation: for most questions, do one targeted search round and then read only 2-3 source-of-truth files.",
    "Prefer generator scripts, canonical metadata files, and primary implementation files over downstream consumers, tests, or workflows.",
    "If you find both the upstream source and the file that loads or exposes it, you usually have enough evidence to answer.",
    "Aim to finish in 5 turns or fewer unless the request is genuinely broad or ambiguous.",
    "Once you have evidence from a few relevant files, stop exploring and answer.",
    likelyPaths
      ? `Planner-suggested starting paths:\n${likelyPaths}\nIf one of these looks relevant, read it directly before doing broad searches or directory listings.`
      : "If you already have a likely file path or module path, read it directly before doing broad searches or directory listings.",
    args.includeWebSearch
      ? "Use web_search only when repository contents are insufficient or the question needs current external context."
      : "Do not rely on external web knowledge because web_search is unavailable for this request.",
    "In your final answer, reference relevant files and line ranges in prose when you have them.",
    "If the evidence is incomplete, say so plainly.",
    "",
    "Available repositories:",
    repoSummary || "- none",
  ].join("\n");
}
