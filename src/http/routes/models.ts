import type { FastifyInstance } from "fastify";
import { listCodexModels } from "../../core/auth/codexAuth.js";

export async function registerModelRoutes(app: FastifyInstance) {
  app.get("/v1/models", async () => await listCodexModels());
}
