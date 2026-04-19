import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create as createTarArchive } from "tar";
import { describe, expect, it } from "vitest";
import type { ImmanenceConfig } from "../config.js";
import { extractSnapshotArchive, prepareRepoHandle } from "./repoCache.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "immanence-repo-cache-"),
  );
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("extractSnapshotArchive", () => {
  it("extracts a stripped snapshot and cleans up temporary artifacts", async () => {
    await withTempDir(async (tempDir) => {
      const archiveRoot = path.join(tempDir, "archive-root");
      const repoRoot = path.join(archiveRoot, "repo-snapshot");
      const archivePath = path.join(tempDir, "snapshot.tar.gz");
      const snapshotPath = path.join(tempDir, "snapshots", "abcdef123456");

      await fs.mkdir(path.join(repoRoot, "src"), { recursive: true });
      await fs.writeFile(
        path.join(repoRoot, "src", "main.ts"),
        "export const message = 'hello';\n",
      );
      await createTarArchive(
        {
          cwd: archiveRoot,
          file: archivePath,
          gzip: true,
        },
        ["repo-snapshot"],
      );

      await extractSnapshotArchive({
        archivePath,
        snapshotPath,
        repo: "owner/repo",
        ref: "abcdef123456",
        preferSystemTar: false,
      });

      await expect(
        fs.readFile(path.join(snapshotPath, "src", "main.ts"), "utf8"),
      ).resolves.toContain("message");
      await expect(fs.access(archivePath)).rejects.toBeTruthy();

      const siblings = await fs.readdir(path.dirname(snapshotPath));
      expect(siblings).toEqual(["abcdef123456"]);
    });
  });

  it("fails explicitly when cached resolution metadata is malformed", async () => {
    await withTempDir(async (tempDir) => {
      const config: ImmanenceConfig = {
        dataDir: path.join(tempDir, "data"),
        cacheDir: path.join(tempDir, "cache"),
        authFilePath: path.join(tempDir, "auth.json"),
        reposDir: path.join(tempDir, "repos", "github.com"),
        runsDir: path.join(tempDir, "runs"),
        staleRepoMs: 60_000,
        maxReposPerRequest: 5,
        maxInferredRepos: 2,
        defaultModel: "gpt-5.4-mini",
        requestTimeoutMs: 300_000,
        braveApiKey: null,
      };
      const repoRoot = path.join(config.reposDir, "owner", "repo");
      const resolutionPath = path.join(repoRoot, "refs", "HEAD.json");

      await fs.mkdir(path.dirname(resolutionPath), { recursive: true });
      await fs.writeFile(resolutionPath, JSON.stringify({ fetchedAt: "bad" }));

      await expect(
        prepareRepoHandle({
          input: {
            repo: "owner/repo",
            owner: "owner",
            name: "repo",
            alias: "repo",
            inferred: false,
          },
          config,
          refresh: "never",
        }),
      ).rejects.toThrow(
        `Invalid cached resolution metadata: ${resolutionPath}`,
      );
    });
  });
});
