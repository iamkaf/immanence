import fs from "node:fs/promises";
import path from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { z } from "zod";
import { codexProviderId, type CodexProviderId } from "../types.js";
import { ensureDir, pathExists } from "../../util/fs.js";
import { stableStringify } from "../../util/json.js";

const oauthCredentialsSchema = z
  .object({
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
  })
  .catchall(z.unknown());

const authStoreSchema = z.object({
  providers: z.record(z.string(), oauthCredentialsSchema),
});

type AuthStore = {
  providers: Partial<Record<CodexProviderId, OAuthCredentials>>;
};

function parseAuthStore(input: unknown): AuthStore {
  try {
    return authStoreSchema.parse(input);
  } catch {
    throw new Error("Auth store is invalid.");
  }
}

export async function readAuthStore(authFilePath: string): Promise<AuthStore> {
  if (!(await pathExists(authFilePath))) {
    return { providers: {} };
  }
  const text = await fs.readFile(authFilePath, "utf8");
  return parseAuthStore(JSON.parse(text));
}

async function writeAuthStore(authFilePath: string, store: AuthStore) {
  await ensureDir(path.dirname(authFilePath));
  await fs.writeFile(authFilePath, stableStringify(store), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function setStoredCredentials(
  authFilePath: string,
  credentials: OAuthCredentials,
) {
  const store = await readAuthStore(authFilePath);
  await writeAuthStore(authFilePath, {
    providers: {
      ...store.providers,
      [codexProviderId]: credentials,
    },
  });
}

export async function clearStoredCredentials(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  const providers = { ...store.providers };
  delete providers[codexProviderId];
  await writeAuthStore(authFilePath, { providers });
}
