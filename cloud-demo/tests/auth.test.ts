import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createAuthenticateHook, isPublicPath } from "../src/auth.ts";

interface MockReply {
  statusCode: number;
  body: unknown;
  code(status: number): MockReply;
  send(payload: unknown): MockReply;
}

function createReply(): MockReply {
  const reply: MockReply = {
    statusCode: 200,
    body: undefined,
    code(status) {
      reply.statusCode = status;
      return reply;
    },
    send(payload) {
      reply.body = payload;
      return reply;
    },
  };
  return reply;
}

function asRequest(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function asReply(reply: MockReply): FastifyReply {
  return reply as unknown as FastifyReply;
}

describe("createAuthenticateHook", () => {
  it("未配置令牌时直接放行", async () => {
    const hook = createAuthenticateHook();
    const reply = createReply();
    await hook(asRequest({}), asReply(reply));
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toBeUndefined();
  });

  it("令牌匹配时放行", async () => {
    const hook = createAuthenticateHook("secret-token");
    const reply = createReply();
    await hook(
      asRequest({ authorization: "Bearer secret-token" }),
      asReply(reply),
    );
    expect(reply.statusCode).toBe(200);
  });

  it("令牌缺失时返回 401", async () => {
    const hook = createAuthenticateHook("secret-token");
    const reply = createReply();
    await hook(asRequest({}), asReply(reply));
    expect(reply.statusCode).toBe(401);
  });

  it("令牌错误时返回 401", async () => {
    const hook = createAuthenticateHook("secret-token");
    const reply = createReply();
    await hook(
      asRequest({ authorization: "Bearer wrong-token" }),
      asReply(reply),
    );
    expect(reply.statusCode).toBe(401);
  });
});

describe("isPublicPath", () => {
  it("健康检查是公开路径", () => {
    expect(isPublicPath("/health")).toBe(true);
  });

  it("带查询串的健康检查仍是公开路径", () => {
    expect(isPublicPath("/health?verbose=1")).toBe(true);
  });

  it("业务路径不是公开路径", () => {
    expect(isPublicPath("/v1/translate")).toBe(false);
  });
});