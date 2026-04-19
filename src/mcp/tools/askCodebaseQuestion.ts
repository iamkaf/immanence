import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { answerQuestion } from "../../core/service.js";
import { AppError } from "../../core/errors.js";

const inputSchema = {
  question: z.string().min(1),
  repos: z
    .array(
      z.object({
        repo: z.string().min(1),
        ref: z.string().min(1).optional(),
        alias: z.string().min(1).optional(),
      }),
    )
    .max(5)
    .optional(),
  repoHints: z
    .object({
      owner: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
    })
    .optional(),
  model: z.string().min(1).optional(),
  includeWebSearch: z.boolean().optional(),
  refresh: z.enum(["never", "if-stale", "always"]).optional(),
  maxToolCalls: z.number().int().positive().max(100).optional(),
};

export function registerAskCodebaseQuestionTool(server: McpServer) {
  server.registerTool(
    "ask_codebase_question",
    {
      description:
        "Answer a question about one or more public GitHub repositories.",
      inputSchema,
    },
    async (input) => {
      try {
        const response = await answerQuestion(input);
        return {
          content: [{ type: "text", text: response.answer }],
          structuredContent: response,
        };
      } catch (error) {
        if (error instanceof AppError) {
          const payload =
            error.code === "REPO_INFERENCE_AMBIGUOUS"
              ? {
                  error: {
                    code: error.code,
                    message: error.message,
                    ...(typeof error.details === "object" && error.details
                      ? error.details
                      : {}),
                  },
                }
              : {
                  error: {
                    code: error.code,
                    message: error.message,
                    details: error.details,
                  },
                };
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
            isError: true,
          };
        }
        throw error;
      }
    },
  );
}
