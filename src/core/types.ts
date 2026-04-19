import type { Api, Model } from "@mariozechner/pi-ai";
import { z } from "zod";

export const codexProviderId = "openai-codex" as const;

export const refreshModeSchema = z.enum(["never", "if-stale", "always"]);

const repoRequestSchema = z.object({
  repo: z.string().min(1),
  ref: z.string().min(1).optional(),
  alias: z.string().min(1).optional(),
});

const repoHintsSchema = z.object({
  owner: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
});

export const questionRequestSchema = z.object({
  question: z.string().min(1),
  repos: z.array(repoRequestSchema).max(5).optional(),
  repoHints: repoHintsSchema.optional(),
  model: z.string().min(1).optional(),
  includeWebSearch: z.boolean().optional(),
  refresh: refreshModeSchema.optional(),
  maxToolCalls: z.number().int().positive().max(100).optional(),
});

const repoCandidateSchema = z.object({
  repo: z.string().min(1),
  confidence: z.number(),
  reason: z.string(),
});

const suggestedRepoRequestSchema = repoRequestSchema.pick({ repo: true });

export const repoInferenceAmbiguousDetailsSchema = z.object({
  candidates: z.array(repoCandidateSchema),
  suggestedRequest: z.object({
    question: questionRequestSchema.shape.question,
    repos: z.array(suggestedRepoRequestSchema),
  }),
});

export type CodexProviderId = typeof codexProviderId;
export type RefreshMode = z.infer<typeof refreshModeSchema>;
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

export type QuestionResponseRepo = Pick<
  RepoHandle,
  "repo" | "alias" | "refRequested" | "commitSha" | "defaultBranch" | "inferred"
>;

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type QuestionResponse = {
  answer: string;
  model: string;
  repos: QuestionResponseRepo[];
  citations: Citation[];
  trace: TraceEntry[];
  usage?: TokenUsage;
  warnings: string[];
};

export type RepoInferenceAmbiguousDetails = z.infer<
  typeof repoInferenceAmbiguousDetailsSchema
>;

export type RepoInferenceAmbiguous = {
  error: {
    code: "REPO_INFERENCE_AMBIGUOUS";
    message: string;
  } & RepoInferenceAmbiguousDetails;
};

export type AuthStatus = {
  providerId: CodexProviderId;
  signedIn: boolean;
  expiresAt: number | null;
};

export type CodexModelSummary = Pick<
  Model<Api>,
  "id" | "name" | "reasoning"
> & {
  contextLength: Model<Api>["contextWindow"];
  inputModalities: Model<Api>["input"];
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: "brave";
};

export const sourceDiscoveryPlanSchema = z.object({
  explicitRepos: z.array(z.string()).default([]),
  primarySubjects: z.array(z.string()).default([]),
  secondarySubjects: z.array(z.string()).default([]),
  packageIdentifiers: z.array(z.string()).default([]),
  repoQueries: z.array(z.string()).default([]),
  likelyPaths: z.array(z.string()).default([]),
  crossSource: z.boolean().default(false),
});

export type SourceDiscoveryPlan = z.infer<typeof sourceDiscoveryPlanSchema>;

export type ProgressEvent = {
  phase: "request" | "resolve" | "repo" | "auth" | "agent" | "tool" | "cleanup";
  level?: "info" | "warn" | "error";
  message: string;
  repo?: string;
  tool?: string;
  path?: string;
  detail?: string;
};
