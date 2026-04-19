import readline from "node:readline/promises";
import { getModels } from "@mariozechner/pi-ai";
import { getOAuthApiKey, loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type { AuthStatus } from "../types.js";
import { AppError } from "../errors.js";
import { clearStoredCredentials, readAuthStore, setStoredCredentials } from "./authStore.js";
import { execCommand } from "../../util/process.js";

const PROVIDER_ID = "openai-codex" as const;

async function openExternal(url: string) {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await execCommand(command, args).catch(() => undefined);
}

async function promptForCode(message: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${message}\n> `);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function getAuthStatus(authFilePath: string): Promise<AuthStatus> {
  const store = await readAuthStore(authFilePath);
  const credentials = store.providers[PROVIDER_ID];
  return {
    providerId: PROVIDER_ID,
    signedIn: !!credentials,
    expiresAt: typeof credentials?.expires === "number" ? credentials.expires : null,
  };
}

export async function loginCodex(authFilePath: string) {
  const credentials = await loginOpenAICodex({
    onAuth: ({ url, instructions }) => {
      process.stderr.write(`Open this URL to finish Codex sign-in:\n${url}\n`);
      if (instructions) process.stderr.write(`${instructions}\n`);
      void openExternal(url);
    },
    onPrompt: async (prompt) => await promptForCode(prompt.message),
    originator: "immanence",
  });
  await setStoredCredentials(authFilePath, credentials);
  return await getAuthStatus(authFilePath);
}

export async function logoutCodex(authFilePath: string) {
  await clearStoredCredentials(authFilePath);
  return await getAuthStatus(authFilePath);
}

export async function resolveCodexApiKey(authFilePath: string) {
  const store = await readAuthStore(authFilePath);
  const resolved = await getOAuthApiKey(PROVIDER_ID, store.providers);
  if (!resolved) {
    throw new AppError("AUTH_REQUIRED", "Not signed in. Run `immanence auth login` first.", 401);
  }
  await setStoredCredentials(authFilePath, resolved.newCredentials);
  return resolved.apiKey;
}

function normalizeModelId(modelId: string | undefined) {
  const raw = modelId?.trim();
  if (!raw) return "gpt-5.4";
  if (raw.startsWith("openai/")) return raw.slice("openai/".length) || "gpt-5.4";
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
  return models.find((entry) => entry.id === normalized) ?? models.find((entry) => entry.id === "gpt-5.4") ?? models[0];
}
