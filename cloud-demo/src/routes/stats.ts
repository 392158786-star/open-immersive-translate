import type { FastifyInstance } from "fastify";
import type { MemoryQueryStore } from "../app.ts";

export function registerStatsRoute(
  app: FastifyInstance,
  memory: MemoryQueryStore,
): void {
  app.get("/v1/stats", async () => {
    return memory.getStats();
  });
}
