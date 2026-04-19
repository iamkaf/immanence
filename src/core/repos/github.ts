import { AppError } from "../errors.js";

type GitHubRepo = {
  owner: string;
  name: string;
  repo: string;
};

export function parseGitHubRepo(input: string): GitHubRepo {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError("INVALID_REQUEST", "Repository cannot be empty.");
  }

  const urlMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/)?$/i,
  );
  if (urlMatch) {
    const owner = urlMatch[1] ?? "";
    const name = (urlMatch[2] ?? "").replace(/\.git$/i, "");
    return { owner, name, repo: `${owner}/${name}` };
  }

  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) {
    const owner = shortMatch[1] ?? "";
    const name = (shortMatch[2] ?? "").replace(/\.git$/i, "");
    return { owner, name, repo: `${owner}/${name}` };
  }

  throw new AppError(
    "INVALID_REQUEST",
    `Unsupported repository reference: ${input}`,
  );
}

export function buildGitHubCloneUrl(repo: GitHubRepo) {
  return `https://github.com/${repo.owner}/${repo.name}.git`;
}

export function buildGitHubTarballUrl(
  owner: string,
  name: string,
  ref: string,
) {
  return `https://codeload.github.com/${owner}/${name}/tar.gz/${ref}`;
}
