import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAuthStore } from "./authStore.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "immanence-auth-store-"),
  );
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

describe("readAuthStore", () => {
  it("returns an empty store when the auth file is missing", async () => {
    await withTempDir(async (tempDir) => {
      await expect(
        readAuthStore(path.join(tempDir, "auth.json")),
      ).resolves.toEqual({
        providers: {},
      });
    });
  });

  it("fails explicitly when the auth file contains invalid json", async () => {
    await withTempDir(async (tempDir) => {
      const authFilePath = path.join(tempDir, "auth.json");
      await fs.writeFile(authFilePath, "{not-json", "utf8");

      await expect(readAuthStore(authFilePath)).rejects.toThrow(SyntaxError);
    });
  });

  it("fails explicitly when the auth file does not contain a providers object", async () => {
    await withTempDir(async (tempDir) => {
      const authFilePath = path.join(tempDir, "auth.json");
      await fs.writeFile(authFilePath, JSON.stringify({}), "utf8");

      await expect(readAuthStore(authFilePath)).rejects.toThrow(
        "Auth store is invalid.",
      );
    });
  });
});
