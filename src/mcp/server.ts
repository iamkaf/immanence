import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAskCodebaseQuestionTool } from "./tools/askCodebaseQuestion.js";

export async function startMcpServer() {
  const server = new McpServer({
    name: "immanence",
    version: "0.1.0",
  });
  registerAskCodebaseQuestionTool(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
