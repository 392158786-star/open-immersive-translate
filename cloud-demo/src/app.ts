import cors from "@fastify/cors";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";
import { createAuthenticateHook, isPublicPath } from "./auth.ts";
import type { AppConfig } from "./config.ts";
import { registerHealthRoute, type HealthProbes } from "./routes/health.ts";

export interface BuildServerOptions {
  probes?: HealthProbes;
}

/**
 * Compose the Fastify instance from validated configuration.
 * Kept side-effect free so tests can use `app.inject()` without a socket.
 */
export async function buildServer(
  config: AppConfig,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
  });

  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  });

  const authenticate = createAuthenticateHook(config.apiToken);
  app.addHook("onRequest", async (request, reply) => {
    if (isPublicPath(request.url)) return;
    await authenticate(request, reply);
  });

  registerHealthRoute(app, options.probes ?? {});

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