import type { FastifyInstance } from "fastify";
import { answerQuestion } from "../../core/service.js";

export async function registerQuestionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/questions",
    async (request) => await answerQuestion(request.body),
  );
}
