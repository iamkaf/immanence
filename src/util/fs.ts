import fs from "node:fs/promises";

function hasErrorCode(error: unknown, codes: string[]) {
  if (typeof error !== "object" || !error || !("code" in error)) return false;
  return codes.includes(String(error.code));
}

export function isMissingPathError(error: unknown) {
  return hasErrorCode(error, ["ENOENT", "ENOTDIR"]);
}

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export function normalizeRepoPath(input: string | undefined) {
  const value = (input || ".").replace(/\\/g, "/").replace(/^\/+/, "");
  return value || ".";
}

export function toRepoPath(input: string) {
  return input.replace(/\\/g, "/");
}

export function sanitizePathSegment(input: string) {
  return (
    input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item"
  );
}
