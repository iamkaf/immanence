import Fastify from "fastify";
import { AppError, toAppErrorPayload } from "../core/errors.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerQuestionRoutes } from "./routes/questions.js";

export async function createHttpServer() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(toAppErrorPayload(error));
    }
    return reply.send(error);
  });
  await registerHealthRoute(app);
  await registerAuthRoutes(app);
  await registerModelRoutes(app);
  await registerQuestionRoutes(app);
  return app;
}
