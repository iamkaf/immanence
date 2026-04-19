import os from "node:os";
import path from "node:path";

export type ImmanenceConfig = {
  dataDir: string;
  cacheDir: string;
  authFilePath: string;
  reposDir: string;
  runsDir: string;
  staleRepoMs: number;
  maxReposPerRequest: number;
  maxInferredRepos: number;
  defaultModel: string;
  requestTimeoutMs: number;
  braveApiKey: string | null;
};

export function loadConfig(): ImmanenceConfig {
  const dataDir = process.env.IMMANENCE_DATA_DIR || path.join(os.homedir(), ".local", "share", "immanence");
  const cacheDir = process.env.IMMANENCE_CACHE_DIR || path.join(os.homedir(), ".cache", "immanence");
  return {
    dataDir,
    cacheDir,
    authFilePath: path.join(dataDir, "auth.json"),
    reposDir: path.join(dataDir, "repos", "github.com"),
    runsDir: path.join(cacheDir, "runs"),
    staleRepoMs: 10 * 60 * 1000,
    maxReposPerRequest: 5,
    maxInferredRepos: 2,
    defaultModel: process.env.IMMANENCE_DEFAULT_MODEL || "gpt-5.4",
    requestTimeoutMs: 5 * 60 * 1000,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || null,
  };
}
