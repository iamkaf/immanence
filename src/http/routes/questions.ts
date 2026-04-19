import type { FastifyInstance } from "fastify";
import { answerQuestion } from "../../core/service.js";
import { AppError } from "../../core/errors.js";

export async function registerQuestionRoutes(app: FastifyInstance) {
  app.post("/v1/questions", async (request, reply) => {
    try {
      return await answerQuestion(request.body);
    } catch (error) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send(
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
              },
        );
      }
      throw error;
    }
  });
}
