import type { RepoHandle } from "../types.js";

export function buildSystemPrompt(args: {
  repos: RepoHandle[];
  includeWebSearch: boolean;
}) {
  const repoSummary = args.repos
    .map(
      (repo) =>
        `- repoId=${repo.repoId}, repo=${repo.repo}, alias=${repo.alias}, commit=${repo.commitSha}, defaultBranch=${repo.defaultBranch}${
          repo.inferred ? ", inferred=true" : ""
        }`,
    )
    .join("\n");

  return [
    "You are Immanence, a read-only codebase exploration assistant.",
    "Answer using repository evidence whenever possible.",
    "Do not speculate about code you have not inspected.",
    "Use the provided repo handles directly with list/read/search.",
    "Use clone only when you need an additional public GitHub repo that is not already available.",
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
