import cors from "@fastify/cors";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import { createAuthenticateHook, isPublicPath } from "./auth.ts";
import type { AppConfig } from "./config.ts";
import { registerDemoRoute, isDemoPath } from "./routes/demo.ts";
import { registerHealthRoute, type HealthProbes } from "./routes/health.ts";
import { registerTranslateRoute } from "./routes/translate.ts";
import { registerMemoryRoute } from "./routes/memory.ts";
import { registerStatsRoute } from "./routes/stats.ts";
import { registerRequestsRoute } from "./routes/requests.ts";
import type { TranslationOrchestrator } from "./services/orchestrator.ts";
import type {
  MemoryStats,
  TranslationMemory,
  TranslationRequestRecord,
} from "./services/memory-repo.ts";

/** Read-only query surface for the memory and stats routes. */
export interface MemoryQueryStore {
  listMemory(limit?: number): Promise<readonly TranslationMemory[]>;
  listRequests(limit?: number): Promise<readonly TranslationRequestRecord[]>;
  getStats(): Promise<MemoryStats>;
}

export interface AppServices {
  orchestrator?: TranslationOrchestrator;
  memory?: MemoryQueryStore;
  probes?: HealthProbes;
}

/**
 * Compose the Fastify instance from validated configuration.
 * Kept side-effect free so tests can use `app.inject()` without a socket.
 */
export async function buildServer(
  config: AppConfig,
  services: AppServices = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
  });

  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  });

  const authenticate = createAuthenticateHook(config.apiToken);
  app.addHook("onRequest", async (request, reply) => {
    if (isPublicPath(request.url) || isDemoPath(request.url)) return;
    await authenticate(request, reply);
  });

  registerDemoRoute(app);
  registerHealthRoute(app, services.probes ?? {});

  if (services.orchestrator !== undefined) {
    registerTranslateRoute(app, services.orchestrator);
  }
  if (services.memory !== undefined) {
    registerMemoryRoute(app, services.memory);
    registerStatsRoute(app, services.memory);
    registerRequestsRoute(app, services.memory);
  }

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({
      error: "not_found",
      message: "请求的接口不存在。",
    });
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error(error);
    void reply.code(error.statusCode ?? 500).send({
      error: "internal_error",
      message:
        config.nodeEnv === "production" ? "服务内部错误。" : error.message,
    });
  });

  return app;
}
