import { startMcpServer } from "../../mcp/server.js";

export async function serveMcpCommand() {
  await startMcpServer();
}
