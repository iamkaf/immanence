import { createHttpServer } from "../../http/server.js";

export async function serveHttpCommand(port = 8787) {
  const app = await createHttpServer();
  await app.listen({ port, host: "127.0.0.1" });
  process.stderr.write(`HTTP server listening on http://127.0.0.1:${port}\n`);
}
