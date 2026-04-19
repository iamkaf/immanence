import type { ImmanenceConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { Citation, RefreshMode, RepoHandle, ResolvedRepoInput, TraceEntry } from "../types.js";
import { searchWeb } from "../search/webSearch.js";
import { readRepoFile, listRepoFiles, searchRepo } from "../repos/fileReaders.js";
import { prepareRepoHandle } from "../repos/repoCache.js";
import { parseGitHubRepo } from "../repos/github.js";
import { citationsFromWebResults } from "./citations.js";

type SessionRepoEntry = {
  handle: RepoHandle;
  mirrorPath: string;
};

export type AgentSessionState = {
  config: ImmanenceConfig;
  requestId: string;
  refresh: RefreshMode;
  repoEntries: Map<string, SessionRepoEntry>;
  citations: Citation[];
  trace: TraceEntry[];
  warnings: string[];
  onProgress?: (message: string) => void;
};

function findRepoEntry(state: AgentSessionState, repoId: string) {
  const entry = state.repoEntries.get(repoId);
  if (!entry) {
    throw new AppError("INVALID_REQUEST", `Unknown repoId: ${repoId}`);
  }
  return entry;
}

async function cloneRepo(state: AgentSessionState, repo: string, ref?: string, refresh?: string) {
  const parsed = parseGitHubRepo(repo);
  for (const entry of state.repoEntries.values()) {
    if (entry.handle.repo === parsed.repo && (!ref || entry.handle.refRequested === ref)) {
      state.trace.push({
        tool: "clone",
        summary: `Reused ${entry.handle.repo} as ${entry.handle.repoId}.`,
      });
      return {
        repoId: entry.handle.repoId,
        repo: entry.handle.repo,
        refRequested: entry.handle.refRequested,
        commitSha: entry.handle.commitSha,
        defaultBranch: entry.handle.defaultBranch,
        workspacePath: entry.handle.workspacePath,
        status: "reused",
      };
    }
  }

  if (state.repoEntries.size >= state.config.maxReposPerRequest) {
    throw new AppError("INVALID_REQUEST", `Request already uses the maximum of ${state.config.maxReposPerRequest} repositories.`);
  }

  const input: ResolvedRepoInput = {
    repo: parsed.repo,
    owner: parsed.owner,
    name: parsed.name,
    alias: parsed.name,
    ref,
    inferred: false,
  };

  const prepared = await prepareRepoHandle({
    input,
    config: state.config,
    refresh: (refresh as RefreshMode | undefined) ?? state.refresh,
    requestId: state.requestId,
    onProgress: state.onProgress,
  });
  state.repoEntries.set(prepared.handle.repoId, prepared);
  state.trace.push({
    tool: "clone",
    summary: `Cloned ${prepared.handle.repo} as ${prepared.handle.repoId}.`,
  });
  return {
    repoId: prepared.handle.repoId,
    repo: prepared.handle.repo,
    refRequested: prepared.handle.refRequested,
    commitSha: prepared.handle.commitSha,
    defaultBranch: prepared.handle.defaultBranch,
    workspacePath: prepared.handle.workspacePath,
    status: "cloned",
  };
}

export async function executeToolCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
  state: AgentSessionState,
) {
  state.onProgress?.(`tool ${toolName}: started`);
  switch (toolName) {
    case "clone": {
      const result = await cloneRepo(
        state,
        String(rawArgs.repo ?? ""),
        typeof rawArgs.ref === "string" ? rawArgs.ref : undefined,
        typeof rawArgs.refresh === "string" ? rawArgs.refresh : undefined,
      );
      state.onProgress?.(`tool ${toolName}: completed`);
      return result;
    }
    case "list": {
      const entry = findRepoEntry(state, String(rawArgs.repoId ?? ""));
      const result = await listRepoFiles(
        entry.handle,
        typeof rawArgs.path === "string" ? rawArgs.path : undefined,
        typeof rawArgs.depth === "number" ? rawArgs.depth : undefined,
        typeof rawArgs.includeHidden === "boolean" ? rawArgs.includeHidden : undefined,
      );
      state.trace.push({
        tool: "list",
        summary: `Listed ${result.path} in ${entry.handle.repo}.`,
      });
      state.onProgress?.(`tool ${toolName}: completed`);
      return result;
    }
    case "read": {
      const entry = findRepoEntry(state, String(rawArgs.repoId ?? ""));
      const result = await readRepoFile(
        entry.handle,
        String(rawArgs.path ?? ""),
        typeof rawArgs.startLine === "number" ? rawArgs.startLine : undefined,
        typeof rawArgs.endLine === "number" ? rawArgs.endLine : undefined,
      );
      state.citations.push(result.citation);
      state.trace.push({
        tool: "read",
        summary: `Read ${result.path}:${result.startLine}-${result.endLine} in ${entry.handle.repo}.`,
      });
      state.onProgress?.(`tool ${toolName}: completed`);
      return result;
    }
    case "search": {
      const entry = findRepoEntry(state, String(rawArgs.repoId ?? ""));
      const result = await searchRepo(entry.handle, String(rawArgs.query ?? ""), {
        pathGlob: typeof rawArgs.pathGlob === "string" ? rawArgs.pathGlob : undefined,
        regex: typeof rawArgs.regex === "boolean" ? rawArgs.regex : undefined,
        caseSensitive: typeof rawArgs.caseSensitive === "boolean" ? rawArgs.caseSensitive : undefined,
        maxResults: typeof rawArgs.maxResults === "number" ? rawArgs.maxResults : undefined,
      });
      for (const match of result.matches.slice(0, 5)) {
        state.citations.push({
          kind: "file",
          repo: entry.handle.repo,
          commitSha: entry.handle.commitSha,
          path: match.path,
          startLine: match.line,
          endLine: match.line,
        });
      }
      state.trace.push({
        tool: "search",
        summary: `Searched ${entry.handle.repo} for "${result.query}".`,
      });
      state.onProgress?.(`tool ${toolName}: completed (${result.matches.length} matches)`);
      return result;
    }
    case "web_search": {
      const results = await searchWeb(state.config, String(rawArgs.query ?? ""), typeof rawArgs.maxResults === "number" ? rawArgs.maxResults : undefined);
      state.citations.push(...citationsFromWebResults(results));
      state.trace.push({
        tool: "web_search",
        summary: `Searched the web for "${String(rawArgs.query ?? "")}".`,
      });
      state.onProgress?.(`tool ${toolName}: completed (${results.length} results)`);
      return { results };
    }
    default:
      throw new AppError("INVALID_REQUEST", `Unsupported tool: ${toolName}`);
  }
}
