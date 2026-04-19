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

export function resolveStorageDirs(args: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
} = {}) {
  const platform = args.platform ?? process.platform;
  const env = args.env ?? process.env;
  const homedir = args.homedir ?? os.homedir();

  const defaults =
    platform === "win32"
      ? {
          dataDir: path.join(
            env.LOCALAPPDATA || path.join(homedir, "AppData", "Local"),
            "immanence",
            "data",
          ),
          cacheDir: path.join(
            env.LOCALAPPDATA || path.join(homedir, "AppData", "Local"),
            "immanence",
            "cache",
          ),
        }
      : {
          dataDir: path.join(homedir, ".local", "share", "immanence"),
          cacheDir: path.join(homedir, ".cache", "immanence"),
        };

  return {
    dataDir: env.IMMANENCE_DATA_DIR || defaults.dataDir,
    cacheDir: env.IMMANENCE_CACHE_DIR || defaults.cacheDir,
  };
}

export function loadConfig(): ImmanenceConfig {
  const { dataDir, cacheDir } = resolveStorageDirs();
  return {
    dataDir,
    cacheDir,
    authFilePath: path.join(dataDir, "auth.json"),
    reposDir: path.join(dataDir, "repos", "github.com"),
    runsDir: path.join(cacheDir, "runs"),
    staleRepoMs: 10 * 60 * 1000,
    maxReposPerRequest: 5,
    maxInferredRepos: 2,
    defaultModel: process.env.IMMANENCE_DEFAULT_MODEL || "gpt-5.4-mini",
    requestTimeoutMs: 5 * 60 * 1000,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || null,
  };
}
