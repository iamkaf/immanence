import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function joinPath(...parts: string[]) {
  return path.join(...parts);
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

export async function writeTextFile(
  targetPath: string,
  content: string,
  mode?: number,
) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, { encoding: "utf8", mode });
}

export async function readTextFile(targetPath: string) {
  return await fs.readFile(targetPath, "utf8");
}
