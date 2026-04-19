import type { FastifyInstance } from "fastify";
import { loadConfig } from "../../core/config.js";
import { getAuthStatus } from "../../core/auth/codexAuth.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get(
    "/v1/auth/status",
    async () => await getAuthStatus(loadConfig().authFilePath),
  );
}
