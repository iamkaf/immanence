import { randomUUID } from "node:crypto";
import { streamSimple, type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import type { ImmanenceConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { QuestionRequest, QuestionResponse, RefreshMode, RepoHandle } from "../types.js";
import { dedupeCitations, summarizeTrace } from "./transcript.js";
import { buildSystemPrompt } from "./prompts.js";
import { buildAgentTools } from "./toolSpecs.js";
import { executeToolCall, type AgentSessionState } from "./toolExecutor.js";
import { resolveCodexApiKey, resolveCodexModel } from "../auth/codexAuth.js";
import { cleanupRepoHandles } from "../repos/repoCache.js";

function assistantText(message: AssistantMessage) {
  return message.content
    .filter((item): item is Extract<AssistantMessage["content"][number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("");
}

export async function runAgentQuestion(args: {
  config: ImmanenceConfig;
  request: QuestionRequest;
  repos: Array<{ handle: RepoHandle; mirrorPath: string }>;
  onDelta?: (delta: string) => void;
}) : Promise<QuestionResponse> {
  const model = await resolveCodexModel(args.request.model);
  if (!model) {
    throw new AppError("MODEL_ERROR", "No Codex models are available.", 500);
  }
  const apiKey = await resolveCodexApiKey(args.config.authFilePath);
  const requestId = randomUUID();

  const sessionState: AgentSessionState = {
    config: args.config,
    requestId,
    refresh: (args.request.refresh ?? "if-stale") as RefreshMode,
    repoEntries: new Map(args.repos.map((entry) => [entry.handle.repoId, entry])),
    citations: [],
    trace: [],
    warnings: [],
  };

  const messages: Message[] = [
    {
      role: "user",
      content: args.request.question,
      timestamp: Date.now(),
    },
  ];

  try {
    let finalAnswer = "";
    let usage: QuestionResponse["usage"];
    let toolCallCount = 0;

    for (let turn = 0; turn < 12; turn += 1) {
      const stream = streamSimple(
        model,
        {
          systemPrompt: buildSystemPrompt({
            repos: [...sessionState.repoEntries.values()].map((entry) => entry.handle),
            includeWebSearch: !!args.request.includeWebSearch,
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
        }
      }

      const message = await stream.result();
      messages.push(message);

      if (message.stopReason === "aborted" || message.stopReason === "error") {
        throw new AppError("MODEL_ERROR", message.errorMessage || "Model request failed.", 502);
      }

      const toolCalls = message.content.filter(
        (item): item is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => item.type === "toolCall",
      );

      if (toolCalls.length === 0) {
        finalAnswer = assistantText(message).trim();
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
          throw new AppError("TOOL_LIMIT_EXCEEDED", "The agent exceeded the tool-call limit.", 400);
        }
        try {
          const result = await executeToolCall(toolCall.name, toolCall.arguments, sessionState);
          messages.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
            timestamp: Date.now(),
          });
        } catch (error) {
          const appError = error instanceof AppError ? error : new AppError("MODEL_ERROR", String(error), 500);
          messages.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: appError.code,
                    message: appError.message,
                    details: appError.details,
                  },
                }),
              },
            ],
            isError: true,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (!finalAnswer) {
      throw new AppError("AGENT_TIMEOUT", "The agent did not reach a final answer before the turn limit.", 504);
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
    await cleanupRepoHandles(
      [...sessionState.repoEntries.values()].map((entry) => ({
        mirrorPath: entry.mirrorPath,
        workspacePath: entry.handle.workspacePath,
      })),
    );
  }
}
