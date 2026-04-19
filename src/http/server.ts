import Fastify from "fastify";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerQuestionRoutes } from "./routes/questions.js";

export async function createHttpServer() {
  const app = Fastify();
  await registerHealthRoute(app);
  await registerAuthRoutes(app);
  await registerModelRoutes(app);
  await registerQuestionRoutes(app);
  return app;
}
