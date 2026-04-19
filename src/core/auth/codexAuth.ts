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
import { z } from "zod";
import {
  codexProviderId,
  type AuthStatus,
  type CodexModelSummary,
} from "../types.js";
import { AppError } from "../errors.js";
import {
  clearStoredCredentials,
  readAuthStore,
  setStoredCredentials,
} from "./authStore.js";

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

const piCliCredentialSchema = z
  .object({
    type: z.string().optional(),
    access: z.string().optional(),
    refresh: z.string().optional(),
    expires: z.number().optional(),
  })
  .catchall(z.unknown());

const piCliAuthFileSchema = z.record(z.string(), piCliCredentialSchema);

function hasErrorCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function runPiAiLogin(tempDir: string) {
  const cliPath = resolvePiAiCliPath();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "login", codexProviderId], {
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
    if (hasErrorCode(error) && error.code === "ENOENT") {
      throw new Error("Codex login canceled before credentials were saved.");
    }
    throw error;
  }
  const parsed = piCliAuthFileSchema.parse(JSON.parse(raw));
  const credentials = parsed[codexProviderId];
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
  const credentials = store.providers[codexProviderId];
  return {
    providerId: codexProviderId,
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
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function logoutCodex(authFilePath: string) {
  await clearStoredCredentials(authFilePath);
  return await getAuthStatus(authFilePath);
}

export async function resolveCodexApiKey(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  const resolved = await getOAuthApiKey(codexProviderId, store.providers);
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

export async function listCodexModels(): Promise<CodexModelSummary[]> {
  return getModels(codexProviderId).map((model) => ({
    id: model.id,
    name: model.name,
    contextLength: model.contextWindow,
    reasoning: model.reasoning,
    inputModalities: model.input,
  }));
}

export async function resolveCodexModel(modelId?: string) {
  const normalized = normalizeModelId(modelId);
  const models = getModels(codexProviderId);
  if (models.length === 0) {
    throw new AppError("MODEL_ERROR", "No Codex models are available.", 500);
  }

  const resolved = models.find((entry) => entry.id === normalized);
  if (resolved) return resolved;

  throw new AppError(
    modelId?.trim() ? "INVALID_REQUEST" : "MODEL_ERROR",
    modelId?.trim()
      ? `Unknown Codex model: ${modelId}.`
      : `Configured default model is unavailable: ${normalized}.`,
    modelId?.trim() ? 400 : 500,
    {
      requestedModel: normalized,
      availableModels: models.map((entry) => entry.id),
    },
  );
}
