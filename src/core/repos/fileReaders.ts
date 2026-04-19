import fs from "node:fs/promises";
import path from "node:path";
import type { FileCitation, RepoHandle } from "../types.js";
import { AppError } from "../errors.js";
import { execCommand, execCommandOrThrow } from "../../util/process.js";

const MAX_READ_BYTES = 64 * 1024;

function normalizeRepoPath(inputPath: string | undefined) {
  const value = (inputPath || ".").replace(/^\/+/, "");
  return value || ".";
}

async function statOrThrow(fullPath: string) {
  try {
    return await fs.stat(fullPath);
  } catch {
    throw new AppError("PATH_NOT_FOUND", `Path not found: ${fullPath}`, 404);
  }
}

export async function listRepoFiles(handle: RepoHandle, repoPath?: string, depth = 2, includeHidden = false) {
  const normalizedPath = normalizeRepoPath(repoPath);
  const basePath = path.resolve(handle.workspacePath, normalizedPath);
  const stat = await statOrThrow(basePath);
  if (!stat.isDirectory()) {
    throw new AppError("PATH_NOT_FOUND", `Not a directory: ${normalizedPath}`, 404);
  }

  const entries: Array<{ name: string; path: string; kind: "file" | "dir"; size?: number }> = [];

  async function walk(currentPath: string, relativePath: string, remainingDepth: number): Promise<void> {
    const dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name === ".git") continue;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const entryRelPath = relativePath === "." ? entry.name : path.join(relativePath, entry.name);
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: entryRelPath, kind: "dir" });
        if (remainingDepth > 0) {
          await walk(entryPath, entryRelPath, remainingDepth - 1);
        }
      } else if (entry.isFile()) {
        const fileStat = await fs.stat(entryPath);
        entries.push({ name: entry.name, path: entryRelPath, kind: "file", size: fileStat.size });
      }
      if (entries.length >= 200) return;
    }
  }

  await walk(basePath, normalizedPath === "." ? "." : normalizedPath, Math.max(0, depth));

  return {
    path: normalizedPath,
    entries: entries.slice(0, 200),
    truncated: entries.length > 200,
  };
}

function isProbablyBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

export async function readRepoFile(handle: RepoHandle, repoPath: string, startLine?: number, endLine?: number) {
  const normalizedPath = normalizeRepoPath(repoPath);
  const fullPath = path.resolve(handle.workspacePath, normalizedPath);
  const stat = await statOrThrow(fullPath);
  if (!stat.isFile()) {
    throw new AppError("PATH_NOT_FOUND", `Not a file: ${normalizedPath}`, 404);
  }

  const content = await fs.readFile(fullPath);
  if (isProbablyBinary(content)) {
    throw new AppError("FILE_NOT_TEXT", `File is binary: ${normalizedPath}`, 400);
  }

  const text = content.toString("utf8");
  const lines = text.split("\n");
  const safeStart = Math.max(1, startLine ?? 1);
  const safeEnd = Math.min(lines.length, endLine ?? safeStart + 399);
  const sliced = lines.slice(safeStart - 1, safeEnd);
  let truncated = safeEnd < lines.length;
  const selectedText = sliced.join("\n");
  let output = selectedText;

  if (Buffer.byteLength(selectedText, "utf8") > MAX_READ_BYTES) {
    let bytes = 0;
    const pieces: string[] = [];
    for (const line of sliced) {
      const segment = pieces.length === 0 ? line : `\n${line}`;
      const segmentBytes = Buffer.byteLength(segment, "utf8");
      if (bytes + segmentBytes > MAX_READ_BYTES) break;
      pieces.push(pieces.length === 0 ? line : segment);
      bytes += segmentBytes;
    }
    output = pieces.join("");
    truncated = true;
  }

  const citation: FileCitation = {
    kind: "file",
    repo: handle.repo,
    commitSha: handle.commitSha,
    path: normalizedPath,
    startLine: safeStart,
    endLine: safeEnd,
  };

  return {
    path: normalizedPath,
    startLine: safeStart,
    endLine: safeEnd,
    content: output,
    truncated,
    citation,
  };
}

export async function searchRepo(handle: RepoHandle, query: string, args: {
  pathGlob?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
} = {}) {
  const maxResults = Math.min(args.maxResults ?? 20, 100);
  const rgArgs = [
    "--line-number",
    "--column",
    "--no-heading",
    "--color",
    "never",
    "--max-count",
    String(maxResults),
  ];

  if (!args.regex) rgArgs.push("--fixed-strings");
  if (!args.caseSensitive) rgArgs.push("--ignore-case");
  if (args.pathGlob) rgArgs.push("--glob", args.pathGlob);
  rgArgs.push(query);
  rgArgs.push(".");

  const result = await execCommand("rg", rgArgs, { cwd: handle.workspacePath });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new AppError("SEARCH_UNAVAILABLE", result.stderr.trim() || "rg search failed.", 500);
  }

  const matches = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
      if (!match) return null;
      return {
        path: match[1] ?? "",
        line: Number(match[2] ?? 0),
        column: Number(match[3] ?? 0),
        preview: (match[4] ?? "").trim(),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  return {
    query,
    matches,
    truncated: matches.length >= maxResults,
  };
}

export async function repoTopLevelFiles(handle: RepoHandle) {
  const result = await execCommandOrThrow("git", ["ls-files"], { cwd: handle.workspacePath });
  return result.stdout.trim().split("\n").filter(Boolean).slice(0, 1000);
}
