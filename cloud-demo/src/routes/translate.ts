import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TranslationOrchestrator } from "../services/orchestrator.ts";

const translateBodySchema = z
  .object({
    text: z.string().min(1).optional(),
    texts: z.array(z.string().min(1)).min(1).max(20).optional(),
    from: z.string().min(1),
    to: z.string().min(1),
    serviceId: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      (body.text === undefined ? 0 : 1) +
        (body.texts === undefined ? 0 : 1) ===
      1,
    { message: "text 与 texts 必须且只能提供一个。" },
  );

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
    if (parsed.data.texts !== undefined) {
      return orchestrator.translateBatch({
        texts: parsed.data.texts,
        from: parsed.data.from,
        to: parsed.data.to,
        ...(parsed.data.serviceId !== undefined
          ? { serviceId: parsed.data.serviceId }
          : {}),
      });
    }
    return orchestrator.translate({
      text: parsed.data.text as string,
      from: parsed.data.from,
      to: parsed.data.to,
      ...(parsed.data.serviceId !== undefined
        ? { serviceId: parsed.data.serviceId }
        : {}),
    });
  });
}
