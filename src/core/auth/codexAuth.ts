import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getModels } from "@mariozechner/pi-ai";
import {
  getOAuthApiKey,
  type OAuthCredentials,
} from "@mariozechner/pi-ai/oauth";
import type { AuthStatus } from "../types.js";
import { AppError } from "../errors.js";
import {
  clearStoredCredentials,
  readAuthStore,
  setStoredCredentials,
} from "./authStore.js";

const PROVIDER_ID = "openai-codex" as const;

function resolvePiAiCliPath() {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(
      currentDir,
      "node_modules",
      "@mariozechner",
      "pi-ai",
      "dist",
      "cli.js",
    );
    if (existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(
        "Could not locate the installed @mariozechner/pi-ai CLI.",
      );
    }
    currentDir = parentDir;
  }
}

type PiCliAuthFile = Record<
  string,
  {
    type?: string;
    access?: string;
    refresh?: string;
    expires?: number;
    [key: string]: unknown;
  }
>;

async function runPiAiLogin(tempDir: string) {
  const cliPath = resolvePiAiCliPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "login", PROVIDER_ID], {
      cwd: tempDir,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pi-ai login exited with code ${code ?? -1}`));
    });
  });
}

async function loadPiAiCredentials(tempDir: string): Promise<OAuthCredentials> {
  const authPath = path.join(tempDir, "auth.json");
  let raw: string;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error("Codex login canceled before credentials were saved.");
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as PiCliAuthFile;
  const credentials = parsed[PROVIDER_ID];
  if (
    !credentials ||
    typeof credentials.access !== "string" ||
    typeof credentials.refresh !== "string" ||
    typeof credentials.expires !== "number"
  ) {
    throw new Error(
      "pi-ai login did not produce usable openai-codex credentials.",
    );
  }

  const { type: _type, access, refresh, expires, ...rest } = credentials;
  return { access, refresh, expires, ...rest };
}

export async function getAuthStatus(authFilePath: string): Promise<AuthStatus> {
  const store = await readAuthStore(authFilePath);
  const credentials = store.providers[PROVIDER_ID];
  return {
    providerId: PROVIDER_ID,
    signedIn: !!credentials,
    expiresAt:
      typeof credentials?.expires === "number" ? credentials.expires : null,
  };
}

export async function loginCodex(authFilePath: string) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "immanence-pi-ai-auth-"),
  );
  try {
    await runPiAiLogin(tempDir);
    const credentials = await loadPiAiCredentials(tempDir);
    await setStoredCredentials(authFilePath, credentials);
    return await getAuthStatus(authFilePath);
  } finally {
    await fs
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

export async function logoutCodex(authFilePath: string) {
  await clearStoredCredentials(authFilePath);
  return await getAuthStatus(authFilePath);
}

export async function resolveCodexApiKey(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  const resolved = await getOAuthApiKey(PROVIDER_ID, store.providers);
  if (!resolved) {
    throw new AppError(
      "AUTH_REQUIRED",
      "Not signed in. Run `immanence auth login` first.",
      401,
    );
  }
  await setStoredCredentials(authFilePath, resolved.newCredentials);
  return resolved.apiKey;
}

function normalizeModelId(modelId: string | undefined) {
  const raw = modelId?.trim();
  if (!raw) return "gpt-5.4";
  if (raw.startsWith("openai/"))
    return raw.slice("openai/".length) || "gpt-5.4";
  return raw;
}

export async function listCodexModels() {
  return getModels(PROVIDER_ID).map((model) => ({
    id: model.id,
    name: model.name,
    contextLength: model.contextWindow,
    reasoning: model.reasoning,
    inputModalities: model.input,
  }));
}

export async function resolveCodexModel(modelId?: string) {
  const normalized = normalizeModelId(modelId);
  const models = getModels(PROVIDER_ID);
  return (
    models.find((entry) => entry.id === normalized) ??
    models.find((entry) => entry.id === "gpt-5.4") ??
    models[0]
  );
}
