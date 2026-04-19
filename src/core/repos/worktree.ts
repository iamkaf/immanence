import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, sanitizePathSegment } from "../../util/fs.js";
import { execCommandOrThrow } from "../../util/process.js";

export async function createDetachedWorktree(args: {
  mirrorPath: string;
  runsDir: string;
  requestId: string;
  alias: string;
  commitSha: string;
}) {
  const targetPath = path.join(
    args.runsDir,
    args.requestId,
    sanitizePathSegment(args.alias),
  );
  await ensureDir(path.dirname(targetPath));
  await fs.rm(targetPath, { recursive: true, force: true });
  await execCommandOrThrow(
    "git",
    [
      "--git-dir",
      args.mirrorPath,
      "worktree",
      "add",
      "--detach",
      targetPath,
      args.commitSha,
    ],
    { errorPrefix: `git worktree add ${args.alias}` },
  );
  return targetPath;
}

export async function removeDetachedWorktree(
  mirrorPath: string,
  workspacePath: string,
) {
  await execCommandOrThrow(
    "git",
    ["--git-dir", mirrorPath, "worktree", "remove", "--force", workspacePath],
    {
      errorPrefix: `git worktree remove ${workspacePath}`,
    },
  ).catch(() => undefined);
  await fs
    .rm(workspacePath, { recursive: true, force: true })
    .catch(() => undefined);
}
