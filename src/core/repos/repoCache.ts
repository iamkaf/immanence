import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extract as extractTarArchive } from "tar";
import type { ImmanenceConfig } from "../config.js";
import { AppError } from "../errors.js";
import type {
  ProgressEvent,
  RefreshMode,
  RepoHandle,
  ResolvedRepoInput,
} from "../types.js";
import { ensureDir, pathExists, sanitizePathSegment } from "../../util/fs.js";
import {
  execCommand,
  execCommandOrThrow,
  hasCommand,
} from "../../util/process.js";
import { buildGitHubCloneUrl, buildGitHubTarballUrl } from "./github.js";

type PreparedSnapshot = {
  snapshotPath: string;
  defaultBranch: string;
  commitSha: string;
};

type CachedResolution = {
  fetchedAt: number;
  defaultBranch: string;
  commitSha: string;
  resolvedRef: string;
};

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

function parseDefaultBranch(raw: string) {
  const match = raw.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m);
  return match?.[1] ?? "main";
}

function parseResolvedRefs(raw: string) {
  const refs = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = line.match(/^([0-9a-f]{40})\t(.+)$/i);
    if (!match) continue;
    const sha = match[1] ?? "";
    const ref = match[2] ?? "";
    if (!sha || !ref) continue;
    refs.set(ref, sha);
  }
  return refs;
}

function pickResolvedSha(raw: string, ref: string) {
  const refs = parseResolvedRefs(raw);
  return (
    refs.get(`refs/tags/${ref}^{}`) ??
    refs.get(ref) ??
    refs.get(`refs/heads/${ref}`) ??
    refs.get(`refs/tags/${ref}`) ??
    null
  );
}

async function readCachedResolution(
  metadataPath: string,
): Promise<CachedResolution | null> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CachedResolution>;
    if (
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.defaultBranch !== "string" ||
      typeof parsed.commitSha !== "string" ||
      typeof parsed.resolvedRef !== "string"
    ) {
      return null;
    }
    return {
      fetchedAt: parsed.fetchedAt,
      defaultBranch: parsed.defaultBranch,
      commitSha: parsed.commitSha,
      resolvedRef: parsed.resolvedRef,
    };
  } catch {
    return null;
  }
}

function shouldRefreshResolution(
  cached: CachedResolution | null,
  refresh: RefreshMode,
  staleRepoMs: number,
) {
  if (!cached) return true;
  if (refresh === "always") return true;
  if (refresh === "never") return false;
  return Date.now() - cached.fetchedAt > staleRepoMs;
}

async function resolveRemoteSnapshot(
  input: ResolvedRepoInput,
): Promise<CachedResolution> {
  const cloneUrl = buildGitHubCloneUrl(input);
  const headResult = await execCommand("git", [
    "ls-remote",
    "--symref",
    cloneUrl,
    "HEAD",
  ]);
  if (headResult.exitCode !== 0) {
    throw new AppError(
      "REPO_NOT_FOUND",
      `Failed to resolve ${input.repo}: ${headResult.stderr.trim() || headResult.stdout.trim()}`,
      404,
    );
  }

  const defaultBranch = parseDefaultBranch(headResult.stdout);
  const resolvedRef = input.ref?.trim() || defaultBranch;
  let commitSha = pickResolvedSha(headResult.stdout, "HEAD");

  if (input.ref?.trim()) {
    if (COMMIT_SHA_PATTERN.test(resolvedRef)) {
      commitSha = resolvedRef;
    } else {
      const refResult = await execCommand("git", [
        "ls-remote",
        cloneUrl,
        resolvedRef,
        `refs/heads/${resolvedRef}`,
        `refs/tags/${resolvedRef}`,
        `refs/tags/${resolvedRef}^{}`,
      ]);
      if (refResult.exitCode !== 0) {
        throw new AppError(
          "REF_NOT_FOUND",
          `Unable to resolve ref "${resolvedRef}" for ${input.repo}.`,
          404,
        );
      }
      commitSha = pickResolvedSha(refResult.stdout, resolvedRef);
    }
  }

  if (!commitSha) {
    throw new AppError(
      "REF_NOT_FOUND",
      `Unable to resolve ref "${resolvedRef}" for ${input.repo}.`,
      404,
    );
  }

  return {
    fetchedAt: Date.now(),
    defaultBranch,
    commitSha,
    resolvedRef,
  };
}

async function downloadSnapshot(args: {
  input: ResolvedRepoInput;
  snapshotPath: string;
  archivePath: string;
}) {
  const response = await fetch(
    buildGitHubTarballUrl(args.input.owner, args.input.name, args.input.ref!),
  );
  if (!response.ok) {
    throw new AppError(
      response.status === 404 ? "REPO_NOT_FOUND" : "CLONE_FAILED",
      `Failed to download ${args.input.repo}@${args.input.ref}: HTTP ${response.status}.`,
      response.status === 404 ? 404 : 502,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await ensureDir(path.dirname(args.archivePath));
  await fs.writeFile(args.archivePath, buffer);

  await extractSnapshotArchive({
    archivePath: args.archivePath,
    snapshotPath: args.snapshotPath,
    repo: args.input.repo,
    ref: args.input.ref!,
  });
}

async function extractSnapshotArchiveWithLibrary(args: {
  archivePath: string;
  partialPath: string;
  repo: string;
  ref: string;
}) {
  try {
    await extractTarArchive({
      cwd: args.partialPath,
      file: args.archivePath,
      strip: 1,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "tar extract failed.";
    throw new Error(
      `tar extract ${args.repo}@${args.ref} failed with exit code -1: ${detail}`,
    );
  }
}

export async function extractSnapshotArchive(args: {
  archivePath: string;
  snapshotPath: string;
  repo: string;
  ref: string;
  preferSystemTar?: boolean;
}) {
  const partialPath = `${args.snapshotPath}.partial-${randomUUID()}`;
  await ensureDir(partialPath);
  try {
    const shouldUseSystemTar =
      args.preferSystemTar !== false && (await hasCommand("tar"));
    if (shouldUseSystemTar) {
      await execCommandOrThrow(
        "tar",
        ["-xzf", args.archivePath, "-C", partialPath, "--strip-components=1"],
        {
          errorPrefix: `tar extract ${args.repo}@${args.ref}`,
        },
      );
    } else {
      await extractSnapshotArchiveWithLibrary({
        archivePath: args.archivePath,
        partialPath,
        repo: args.repo,
        ref: args.ref,
      });
    }
    await ensureDir(path.dirname(args.snapshotPath));
    await fs.rename(partialPath, args.snapshotPath).catch(async (error) => {
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EEXIST") throw error;
      await fs.rm(partialPath, { recursive: true, force: true });
    });
  } finally {
    await fs
      .rm(partialPath, { recursive: true, force: true })
      .catch(() => undefined);
    await fs.rm(args.archivePath, { force: true }).catch(() => undefined);
  }
}

async function removeLegacyMirror(
  legacyMirrorPath: string,
  onProgress?: (event: ProgressEvent) => void,
  repo?: string,
) {
  if (!(await pathExists(legacyMirrorPath))) return;
  onProgress?.({
    phase: "repo",
    repo,
    message: "removing legacy mirror cache",
  });
  await fs.rm(legacyMirrorPath, { recursive: true, force: true });
}

async function prepareSnapshot(
  input: ResolvedRepoInput,
  config: ImmanenceConfig,
  refresh: RefreshMode,
  onProgress?: (event: ProgressEvent) => void,
): Promise<PreparedSnapshot> {
  const repoRoot = path.join(config.reposDir, input.owner, input.name);
  const legacyMirrorPath = path.join(
    config.reposDir,
    input.owner,
    `${input.name}.git`,
  );
  const resolutionPath = path.join(
    repoRoot,
    "refs",
    `${sanitizePathSegment(input.ref?.trim() || "HEAD")}.json`,
  );
  await ensureDir(path.dirname(resolutionPath));

  let cached = await readCachedResolution(resolutionPath);
  if (shouldRefreshResolution(cached, refresh, config.staleRepoMs)) {
    onProgress?.({
      phase: "repo",
      repo: input.repo,
      message: cached
        ? "refreshing cached repo snapshot"
        : "resolving repo snapshot",
    });
    cached = await resolveRemoteSnapshot(input);
    await fs.writeFile(
      resolutionPath,
      `${JSON.stringify(cached, null, 2)}\n`,
      "utf8",
    );
  } else {
    onProgress?.({
      phase: "repo",
      repo: input.repo,
      message: "reusing cached repo snapshot",
    });
  }

  if (!cached) {
    throw new AppError(
      "MODEL_ERROR",
      `Missing cached snapshot metadata for ${input.repo}.`,
      500,
    );
  }

  const snapshotPath = path.join(repoRoot, "snapshots", cached.commitSha);
  if (!(await pathExists(snapshotPath))) {
    onProgress?.({
      phase: "repo",
      repo: input.repo,
      message: "downloading repo snapshot",
      detail: cached.commitSha.slice(0, 12),
    });
    await downloadSnapshot({
      input: { ...input, ref: cached.commitSha },
      snapshotPath,
      archivePath: path.join(
        config.cacheDir,
        "archives",
        input.owner,
        input.name,
        `${cached.commitSha}.tar.gz`,
      ),
    });
  }

  await removeLegacyMirror(legacyMirrorPath, onProgress, input.repo);

  return {
    snapshotPath,
    defaultBranch: cached.defaultBranch,
    commitSha: cached.commitSha,
  };
}

export async function prepareRepoHandle(args: {
  input: ResolvedRepoInput;
  config: ImmanenceConfig;
  refresh: RefreshMode;
  requestId?: string;
  onProgress?: (event: ProgressEvent) => void;
}) {
  args.onProgress?.({
    phase: "repo",
    repo: args.input.repo,
    message: "preparing snapshot",
  });
  const preparedSnapshot = await prepareSnapshot(
    args.input,
    args.config,
    args.refresh,
    args.onProgress,
  );

  const handle: RepoHandle = {
    repoId: sanitizePathSegment(
      `${args.input.owner}-${args.input.name}-${preparedSnapshot.commitSha.slice(0, 8)}`,
    ),
    repo: args.input.repo,
    owner: args.input.owner,
    name: args.input.name,
    alias: args.input.alias,
    refRequested: args.input.ref,
    defaultBranch: preparedSnapshot.defaultBranch,
    commitSha: preparedSnapshot.commitSha,
    workspacePath: preparedSnapshot.snapshotPath,
    inferred: args.input.inferred,
  };

  return {
    handle,
    snapshotPath: preparedSnapshot.snapshotPath,
  };
}

export async function cleanupRepoHandles(
  _entries: Array<{ snapshotPath: string; workspacePath: string }>,
) {
  return;
}
