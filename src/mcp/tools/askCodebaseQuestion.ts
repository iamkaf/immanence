import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { answerQuestion } from "../../core/service.js";
import {
  AppError,
  stringifyAppError,
  toAppErrorPayload,
} from "../../core/errors.js";
import { questionRequestSchema } from "../../core/types.js";

export function registerAskCodebaseQuestionTool(server: McpServer) {
  server.registerTool(
    "ask_codebase_question",
    {
      description:
        "Answer a question about one or more public GitHub repositories.",
      inputSchema: questionRequestSchema.shape,
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
          const payload = toAppErrorPayload(error);
          return {
            content: [{ type: "text", text: stringifyAppError(error) }],
            structuredContent: payload,
            isError: true,
          };
        }
        throw error;
      }
    },
  );
}
