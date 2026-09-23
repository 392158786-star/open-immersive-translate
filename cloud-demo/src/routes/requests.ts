import type { FastifyInstance } from "fastify";
import type { TranslationRequestRecord } from "../services/memory-repo.ts";

import type { MemoryQueryStore } from "../app.ts";

function parseLimit(query: unknown): number {
  if (typeof query !== "object" || query === null) return 20;
  const raw = (query as Record<string, unknown>).limit;
  if (typeof raw !== "string") return 20;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 20;
}

export function registerRequestsRoute(
  app: FastifyInstance,
  memory: MemoryQueryStore,
): void {
  app.get("/v1/requests", async (request) => {
    const limit = parseLimit(request.query);
    const items: readonly TranslationRequestRecord[] =
      await memory.listRequests(limit);
    return { items };
  });
}