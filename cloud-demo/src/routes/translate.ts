import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TranslationOrchestrator } from "../services/orchestrator.ts";

const translateBodySchema = z.object({
  text: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  serviceId: z.string().min(1).optional(),
});

export function registerTranslateRoute(
  app: FastifyInstance,
  orchestrator: TranslationOrchestrator,
): void {
  app.post("/v1/translate", async (request, reply) => {
    const parsed = translateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({
        error: "invalid_request",
        message: parsed.error.issues[0]?.message ?? "请求体无效。",
      });
      return;
    }
    return orchestrator.translate(parsed.data);
  });
}