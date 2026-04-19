import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { create as createTarArchive } from "tar";
import { describe, expect, it } from "vitest";
import { extractSnapshotArchive } from "./repoCache.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "immanence-repo-cache-"));
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
});
