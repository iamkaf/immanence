import fs from "node:fs/promises";
import path from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { ensureDir, pathExists } from "../../util/fs.js";
import { safeJsonParse, stableStringify } from "../../util/json.js";

const PROVIDER_ID = "openai-codex" as const;

export type AuthStore = {
  providers: Partial<Record<typeof PROVIDER_ID, OAuthCredentials>>;
};

export async function readAuthStore(authFilePath: string): Promise<AuthStore> {
  if (!(await pathExists(authFilePath))) {
    return { providers: {} };
  }
  const text = await fs.readFile(authFilePath, "utf8");
  return safeJsonParse<AuthStore>(text, { providers: {} });
}

export async function writeAuthStore(authFilePath: string, store: AuthStore) {
  await ensureDir(path.dirname(authFilePath));
  await fs.writeFile(authFilePath, stableStringify(store), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function getStoredCredentials(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  return store.providers[PROVIDER_ID] ?? null;
}

export async function setStoredCredentials(
  authFilePath: string,
  credentials: OAuthCredentials,
) {
  const store = await readAuthStore(authFilePath);
  await writeAuthStore(authFilePath, {
    providers: {
      ...store.providers,
      [PROVIDER_ID]: credentials,
    },
  });
}

export async function clearStoredCredentials(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  const providers = { ...store.providers };
  delete providers[PROVIDER_ID];
  await writeAuthStore(authFilePath, { providers });
}
