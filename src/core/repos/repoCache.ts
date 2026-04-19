import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ImmanenceConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { RefreshMode, RepoHandle, ResolvedRepoInput } from "../types.js";
import { ensureDir, pathExists, sanitizePathSegment } from "../../util/fs.js";
import { execCommand, execCommandOrThrow } from "../../util/process.js";
import { buildGitHubCloneUrl } from "./github.js";
import { createDetachedWorktree, removeDetachedWorktree } from "./worktree.js";

type PreparedMirror = {
  mirrorPath: string;
  defaultBranch: string;
  commitSha: string;
};

async function readHeadRef(mirrorPath: string) {
  const result = await execCommandOrThrow("git", ["--git-dir", mirrorPath, "symbolic-ref", "HEAD"], {
    errorPrefix: `git symbolic-ref HEAD`,
  });
  return result.stdout.trim().replace(/^refs\/heads\//, "");
}

async function readFetchTimestamp(mirrorPath: string) {
  const fetchHeadPath = path.join(mirrorPath, "FETCH_HEAD");
  try {
    const stat = await fs.stat(fetchHeadPath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

async function shouldRefreshMirror(mirrorPath: string, refresh: RefreshMode, staleRepoMs: number) {
  if (refresh === "always") return true;
  if (refresh === "never") return false;
  const fetchedAt = await readFetchTimestamp(mirrorPath);
  return Date.now() - fetchedAt > staleRepoMs;
}

async function prepareMirror(
  input: ResolvedRepoInput,
  config: ImmanenceConfig,
  refresh: RefreshMode,
  onProgress?: (message: string) => void,
): Promise<PreparedMirror> {
  const mirrorPath = path.join(config.reposDir, input.owner, `${input.name}.git`);
  const cloneUrl = buildGitHubCloneUrl(input);
  await ensureDir(path.dirname(mirrorPath));

  if (!(await pathExists(mirrorPath))) {
    onProgress?.(`repo ${input.repo}: cloning mirror from GitHub`);
    const result = await execCommand("git", ["clone", "--mirror", cloneUrl, mirrorPath]);
    if (result.exitCode !== 0) {
      throw new AppError("CLONE_FAILED", `Failed to clone ${input.repo}: ${result.stderr.trim() || result.stdout.trim()}`, 502);
    }
  } else if (await shouldRefreshMirror(mirrorPath, refresh, config.staleRepoMs)) {
    onProgress?.(`repo ${input.repo}: refreshing cached mirror`);
    const result = await execCommand("git", ["--git-dir", mirrorPath, "remote", "update", "--prune"]);
    if (result.exitCode !== 0) {
      throw new AppError("CLONE_FAILED", `Failed to refresh ${input.repo}: ${result.stderr.trim() || result.stdout.trim()}`, 502);
    }
  } else {
    onProgress?.(`repo ${input.repo}: reusing cached mirror`);
  }

  let defaultBranch = "main";
  try {
    defaultBranch = await readHeadRef(mirrorPath);
  } catch {
    defaultBranch = "main";
  }

  const ref = input.ref?.trim() || defaultBranch;
  const resolved = await execCommand("git", ["--git-dir", mirrorPath, "rev-parse", ref]);
  if (resolved.exitCode !== 0) {
    throw new AppError("REF_NOT_FOUND", `Unable to resolve ref "${ref}" for ${input.repo}.`, 404);
  }

  return {
    mirrorPath,
    defaultBranch,
    commitSha: resolved.stdout.trim(),
  };
}

export async function prepareRepoHandle(args: {
  input: ResolvedRepoInput;
  config: ImmanenceConfig;
  refresh: RefreshMode;
  requestId?: string;
  onProgress?: (message: string) => void;
}) {
  const requestId = args.requestId || randomUUID();
  args.onProgress?.(`repo ${args.input.repo}: preparing mirror`);
  const preparedMirror = await prepareMirror(args.input, args.config, args.refresh, args.onProgress);
  args.onProgress?.(`repo ${args.input.repo}: creating detached worktree at ${preparedMirror.commitSha.slice(0, 12)}`);
  const workspacePath = await createDetachedWorktree({
    mirrorPath: preparedMirror.mirrorPath,
    runsDir: args.config.runsDir,
    requestId,
    alias: args.input.alias,
    commitSha: preparedMirror.commitSha,
  });

  const handle: RepoHandle = {
    repoId: sanitizePathSegment(`${args.input.owner}-${args.input.name}-${preparedMirror.commitSha.slice(0, 8)}`),
    repo: args.input.repo,
    owner: args.input.owner,
    name: args.input.name,
    alias: args.input.alias,
    refRequested: args.input.ref,
    defaultBranch: preparedMirror.defaultBranch,
    commitSha: preparedMirror.commitSha,
    workspacePath,
    inferred: args.input.inferred,
  };

  return {
    handle,
    mirrorPath: preparedMirror.mirrorPath,
  };
}

export async function cleanupRepoHandles(entries: Array<{ mirrorPath: string; workspacePath: string }>) {
  await Promise.all(entries.map(async (entry) => await removeDetachedWorktree(entry.mirrorPath, entry.workspacePath)));
}
