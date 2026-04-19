import {
  streamSimple,
  type AssistantMessage,
  type Message,
} from "@mariozechner/pi-ai";
import type { ImmanenceConfig } from "../config.js";
import { AppError, stringifyAppError } from "../errors.js";
import type {
  ProgressEvent,
  QuestionRequest,
  QuestionResponse,
  RepoHandle,
  SourceDiscoveryPlan,
} from "../types.js";
import { dedupeCitations, summarizeTrace } from "./transcript.js";
import { buildSystemPrompt } from "./prompts.js";
import { buildStopExplorationMessage } from "./budget.js";
import { buildAgentTools } from "./toolSpecs.js";
import { executeToolCall, type AgentSessionState } from "./toolExecutor.js";
import { resolveCodexApiKey, resolveCodexModel } from "../auth/codexAuth.js";
import { cleanupRepoHandles } from "../repos/repoCache.js";
import { assistantText } from "../../util/piAi.js";

const MAX_TOOL_RESULT_CHARS = 200_000;
const MAX_AGENT_TURNS = 12;

function serializeToolResult(result: unknown) {
  const json = JSON.stringify(result, null, 2);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify(
    {
      truncated: true,
      maxChars: MAX_TOOL_RESULT_CHARS,
      preview: json.slice(0, MAX_TOOL_RESULT_CHARS),
    },
    null,
    2,
  );
}

function buildPlannerGuidance(plannerHints?: SourceDiscoveryPlan | null) {
  if (!plannerHints) return null;

  const lines: string[] = [];
  if (plannerHints.explicitRepos.length > 0) {
    lines.push(`Likely repos: ${plannerHints.explicitRepos.join(", ")}`);
  }
  if (plannerHints.likelyPaths.length > 0) {
    lines.push(
      `Likely starting paths: ${plannerHints.likelyPaths.slice(0, 5).join(", ")}`,
    );
  }
  if (plannerHints.repoQueries.length > 0) {
    lines.push(
      `Fallback search phrases: ${plannerHints.repoQueries.slice(0, 3).join(", ")}`,
    );
  }
  if (lines.length === 0) return null;

  return [
    "Planner guidance from source discovery:",
    ...lines,
    "Use these as starting guesses. Prefer checking hinted paths directly before broad search or list calls.",
  ].join("\n");
}

function toolRequestEvent(toolCall: {
  name: string;
  arguments: Record<string, unknown>;
}): ProgressEvent {
  const args = toolCall.arguments;
  switch (toolCall.name) {
    case "read":
      return {
        phase: "agent",
        tool: toolCall.name,
        path: typeof args.path === "string" ? args.path : undefined,
        message: "requested tool",
      };
    case "list":
      return {
        phase: "agent",
        tool: toolCall.name,
        path: typeof args.path === "string" ? args.path : ".",
        message: "requested tool",
      };
    case "search":
      return {
        phase: "agent",
        tool: toolCall.name,
        path: typeof args.pathGlob === "string" ? args.pathGlob : undefined,
        message: "requested tool",
        detail: typeof args.query === "string" ? `"${args.query}"` : undefined,
      };
    case "clone":
      return {
        phase: "agent",
        tool: toolCall.name,
        repo: typeof args.repo === "string" ? args.repo : undefined,
        message: "requested tool",
      };
    case "web_search":
      return {
        phase: "agent",
        tool: toolCall.name,
        message: "requested tool",
        detail: typeof args.query === "string" ? `"${args.query}"` : undefined,
      };
    default:
      return {
        phase: "agent",
        tool: toolCall.name,
        message: "requested tool",
      };
  }
}

export async function runAgentQuestion(args: {
  config: ImmanenceConfig;
  request: QuestionRequest;
  repos: Array<{ handle: RepoHandle; snapshotPath: string }>;
  plannerHints?: SourceDiscoveryPlan | null;
  onDelta?: (delta: string) => void;
  onProgress?: (event: ProgressEvent) => void;
}): Promise<QuestionResponse> {
  args.onProgress?.({ phase: "agent", message: "resolving model" });
  const model = await resolveCodexModel(
    args.request.model ?? args.config.defaultModel,
  );
  if (!model) {
    throw new AppError("MODEL_ERROR", "No Codex models are available.", 500);
  }
  args.onProgress?.({
    phase: "agent",
    message: "using model",
    detail: model.id,
  });
  args.onProgress?.({ phase: "auth", message: "resolving API key" });
  const apiKey = await resolveCodexApiKey(args.config.authFilePath);

  const sessionState: AgentSessionState = {
    config: args.config,
    refresh: args.request.refresh ?? "if-stale",
    repoEntries: new Map(
      args.repos.map((entry) => [entry.handle.repoId, entry]),
    ),
    citations: [],
    trace: [],
    warnings: [],
    onProgress: args.onProgress,
  };

  const messages: Message[] = [
    {
      role: "user",
      content: args.request.question,
      timestamp: Date.now(),
    },
  ];
  const plannerGuidance = buildPlannerGuidance(args.plannerHints);
  if (plannerGuidance) {
    messages.push({
      role: "user",
      content: plannerGuidance,
      timestamp: Date.now(),
    });
  }

  try {
    let finalAnswer = "";
    let usage: QuestionResponse["usage"];
    let toolCallCount = 0;

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
      const stopMessage = buildStopExplorationMessage({
        turn,
        maxTurns: MAX_AGENT_TURNS,
        citations: sessionState.citations,
      });
      if (stopMessage) {
        messages.push({
          role: "user",
          content: stopMessage,
          timestamp: Date.now(),
        });
      }
      args.onProgress?.({
        phase: "agent",
        message: `turn ${turn + 1}: sending request`,
      });
      const stream = streamSimple(
        model,
        {
          systemPrompt: buildSystemPrompt({
            repos: [...sessionState.repoEntries.values()].map(
              (entry) => entry.handle,
            ),
            includeWebSearch: !!args.request.includeWebSearch,
            plannerHints: args.plannerHints,
          }),
          messages,
          tools: buildAgentTools(!!args.request.includeWebSearch),
        },
        {
          apiKey,
          maxTokens: 1400,
          reasoning: "low",
        },
      );

      for await (const event of stream) {
        if (event.type === "text_delta") {
          args.onDelta?.(event.delta);
          continue;
        }
        if (event.type === "toolcall_end") {
          args.onProgress?.(toolRequestEvent(event.toolCall));
        }
      }

      const message = await stream.result();
      messages.push(message);

      if (message.stopReason === "aborted" || message.stopReason === "error") {
        throw new AppError(
          "MODEL_ERROR",
          message.errorMessage || "Model request failed.",
          502,
        );
      }

      const toolCalls = message.content.filter(
        (
          item,
        ): item is Extract<
          AssistantMessage["content"][number],
          { type: "toolCall" }
        > => item.type === "toolCall",
      );

      if (toolCalls.length === 0) {
        finalAnswer = assistantText(message).trim();
        args.onProgress?.({ phase: "agent", message: "produced final answer" });
        usage = {
          promptTokens: message.usage.input,
          completionTokens: message.usage.output,
          totalTokens: message.usage.totalTokens,
        };
        break;
      }

      for (const toolCall of toolCalls) {
        toolCallCount += 1;
        if (toolCallCount > (args.request.maxToolCalls ?? 40)) {
          throw new AppError(
            "TOOL_LIMIT_EXCEEDED",
            "The agent exceeded the tool-call limit.",
            400,
          );
        }
        try {
          args.onProgress?.({
            phase: "tool",
            tool: toolCall.name,
            message: "executing",
          });
          const result = await executeToolCall(
            toolCall.name,
            toolCall.arguments,
            sessionState,
          );
          messages.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: serializeToolResult(result) }],
            isError: false,
            timestamp: Date.now(),
          });
        } catch (error) {
          const appError =
            error instanceof AppError
              ? error
              : new AppError("MODEL_ERROR", String(error), 500);
          args.onProgress?.({
            phase: "tool",
            tool: toolCall.name,
            level: "error",
            message: "failed",
            detail: appError.code,
          });
          messages.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [
              {
                type: "text",
                text: stringifyAppError(appError),
              },
            ],
            isError: true,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (!finalAnswer) {
      throw new AppError(
        "AGENT_TIMEOUT",
        "The agent did not reach a final answer before the turn limit.",
        504,
      );
    }

    return {
      answer: finalAnswer,
      model: model.id,
      repos: [...sessionState.repoEntries.values()].map((entry) => ({
        repo: entry.handle.repo,
        alias: entry.handle.alias,
        refRequested: entry.handle.refRequested,
        commitSha: entry.handle.commitSha,
        defaultBranch: entry.handle.defaultBranch,
        inferred: entry.handle.inferred,
      })),
      citations: dedupeCitations(sessionState.citations),
      trace: summarizeTrace(sessionState.trace),
      usage,
      warnings: sessionState.warnings,
    };
  } finally {
    args.onProgress?.({ phase: "cleanup", message: "cleaning up snapshots" });
    await cleanupRepoHandles(
      [...sessionState.repoEntries.values()].map((entry) => ({
        snapshotPath: entry.snapshotPath,
        workspacePath: entry.handle.workspacePath,
      })),
    );
  }
}
