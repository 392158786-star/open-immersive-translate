import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export type AuthenticateHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

/**
 * Build an `onRequest` hook that requires `Authorization: Bearer <token>`.
 * When no token is configured the hook stays open so local demos work
 * without extra setup; production deployments must set API_TOKEN.
 */
export function createAuthenticateHook(apiToken?: string): AuthenticateHook {
  return async function authenticate(request, reply): Promise<void> {
    if (!apiToken) return;

    const header = request.headers.authorization;
    const expected = `Bearer ${apiToken}`;
    if (typeof header !== "string" || !constantTimeEqual(header, expected)) {
      await reply.code(401).send({
        error: "unauthorized",
        message: "缺少或无效的访问令牌。",
      });
    }
  };
}

/** Public paths that must stay reachable without a token. */
export function isPublicPath(url: string): boolean {
  const path = url.split("?")[0];
  return path === "/health";
}