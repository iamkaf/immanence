import { z } from "zod";

export const refreshModeSchema = z.enum(["never", "if-stale", "always"]);

export const repoRequestSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).optional(),
  alias: z.string().min(1).optional(),
});

export const questionRequestSchema = z.object({
  question: z.string().min(1),
  repos: z.array(repoRequestSchema).max(5).optional(),
  repoHints: z
    .object({
      owner: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
    })
    .optional(),
  model: z.string().min(1).optional(),
  includeWebSearch: z.boolean().optional(),
  refresh: refreshModeSchema.optional(),
  maxToolCalls: z.number().int().positive().max(100).optional(),
});

export type RefreshMode = z.infer<typeof refreshModeSchema>;
export type RepoRequest = z.infer<typeof repoRequestSchema>;
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

export type ResolvedRepoInput = {
  repo: string;
  owner: string;
  name: string;
  alias: string;
  ref?: string;
  inferred: boolean;
};

export type RepoHandle = {
  repoId: string;
  repo: string;
  owner: string;
  name: string;
  alias: string;
  refRequested?: string;
  defaultBranch: string;
  commitSha: string;
  workspacePath: string;
  inferred: boolean;
};

export type FileCitation = {
  kind: "file";
  repo: string;
  commitSha: string;
  path: string;
  startLine: number;
  endLine: number;
};

export type WebCitation = {
  kind: "web";
  url: string;
  title: string;
};

export type Citation = FileCitation | WebCitation;

export type TraceEntry = {
  tool: "clone" | "list" | "read" | "search" | "web_search";
  summary: string;
};

export type QuestionResponse = {
  answer: string;
  model: string;
  repos: Array<{
    repo: string;
    alias: string;
    refRequested?: string;
    commitSha: string;
    defaultBranch?: string;
    inferred: boolean;
  }>;
  citations: Citation[];
  trace: TraceEntry[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  warnings: string[];
};

export type RepoCandidate = {
  repo: string;
  confidence: number;
  reason: string;
};

export type RepoInferenceAmbiguous = {
  error: {
    code: "REPO_INFERENCE_AMBIGUOUS";
    message: string;
    candidates: RepoCandidate[];
    suggestedRequest: {
      question: string;
      repos: Array<{ repo: string }>;
    };
  };
};

export type AuthStatus = {
  providerId: "openai-codex";
  signedIn: boolean;
  expiresAt: number | null;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: "brave";
};
