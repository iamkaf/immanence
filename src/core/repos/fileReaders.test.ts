import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RepoHandle } from "../types.js";
import { AppError } from "../errors.js";
import {
  listRepoFiles,
  readRepoFile,
  searchRepoWithNode,
} from "./fileReaders.js";

function buildHandle(workspacePath: string): RepoHandle {
  return {
    repoId: "owner-repo-12345678",
    repo: "owner/repo",
    owner: "owner",
    name: "repo",
    alias: "repo",
    defaultBranch: "main",
    commitSha: "1234567890abcdef",
    workspacePath,
    inferred: false,
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "immanence-file-readers-"));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("fileReaders", () => {
  it("normalizes list and read paths to forward slashes", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src", "lib"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src", "lib", "main.ts"), "export const value = 1;\n");

      const handle = buildHandle(tempDir);
      const listed = await listRepoFiles(handle, "src\\lib");
      const read = await readRepoFile(handle, "src\\lib\\main.ts");

      expect(listed.path).toBe("src/lib");
      expect(listed.entries).toContainEqual(
        expect.objectContaining({
          path: "src/lib/main.ts",
          kind: "file",
        }),
      );
      expect(read.path).toBe("src/lib/main.ts");
      expect(read.citation.path).toBe("src/lib/main.ts");
    });
  });

  it("supports fixed-string search with case-insensitive matching", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "src", "main.ts"),
        'const greeting = "Needle";\n',
      );

      const result = await searchRepoWithNode(
        buildHandle(tempDir),
        "needle",
        {},
        20,
      );

      expect(result.matches).toEqual([
        {
          path: "src/main.ts",
          line: 1,
          column: 19,
          preview: 'const greeting = "Needle";',
        },
      ]);
    });
  });

  it("supports regex search and rejects invalid regex patterns", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "src", "main.ts"),
        "export const answer = 42;\n",
      );

      const result = await searchRepoWithNode(
        buildHandle(tempDir),
        "answer\\s*=\\s*42",
        { regex: true },
        20,
      );

      expect(result.matches[0]).toMatchObject({
        path: "src/main.ts",
        line: 1,
        column: 14,
      });

      await expect(
        searchRepoWithNode(buildHandle(tempDir), "[", { regex: true }, 20),
      ).rejects.toMatchObject({
        code: "SEARCH_UNAVAILABLE",
      } satisfies Partial<AppError>);
    });
  });

  it("supports case-sensitive matching", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src", "main.ts"), "const Needle = true;\n");

      const insensitive = await searchRepoWithNode(
        buildHandle(tempDir),
        "needle",
        {},
        20,
      );
      const sensitive = await searchRepoWithNode(
        buildHandle(tempDir),
        "needle",
        { caseSensitive: true },
        20,
      );

      expect(insensitive.matches).toHaveLength(1);
      expect(sensitive.matches).toEqual([]);
    });
  });

  it("filters by path glob using normalized paths", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.mkdir(path.join(tempDir, "tests"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src", "main.ts"), "const target = true;\n");
      await fs.writeFile(path.join(tempDir, "tests", "main.test.ts"), "const target = true;\n");

      const result = await searchRepoWithNode(
        buildHandle(tempDir),
        "target",
        { pathGlob: "**/*.test.ts" },
        20,
      );

      expect(result.matches).toEqual([
        {
          path: "tests/main.test.ts",
          line: 1,
          column: 7,
          preview: "const target = true;",
        },
      ]);
    });
  });

  it("skips hidden files, hidden directories, and binary files", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.mkdir(path.join(tempDir, ".hidden"), { recursive: true });
      await fs.writeFile(path.join(tempDir, "src", "visible.ts"), "const visible = true;\n");
      await fs.writeFile(path.join(tempDir, ".hidden", "ignored.ts"), "const visible = true;\n");
      await fs.writeFile(path.join(tempDir, ".ignored.ts"), "const visible = true;\n");
      await fs.writeFile(
        path.join(tempDir, "src", "binary.bin"),
        Buffer.from([0x00, 0x01, 0x02, 0x03]),
      );

      const result = await searchRepoWithNode(
        buildHandle(tempDir),
        "visible",
        {},
        20,
      );

      expect(result.matches).toEqual([
        {
          path: "src/visible.ts",
          line: 1,
          column: 7,
          preview: "const visible = true;",
        },
      ]);
    });
  });

  it("stops after the global maxResults limit", async () => {
    await withTempDir(async (tempDir) => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "src", "a.ts"),
        "const hit = 1;\nconst hit = 2;\n",
      );
      await fs.writeFile(path.join(tempDir, "src", "b.ts"), "const hit = 3;\n");

      const result = await searchRepoWithNode(
        buildHandle(tempDir),
        "hit",
        {},
        2,
      );

      expect(result.matches).toHaveLength(2);
      expect(result.truncated).toBe(true);
    });
  });
});
