import { describe, expect, it } from "vitest";
import { buildServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { isDemoPath } from "../src/routes/demo.ts";

const testEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  API_TOKEN: "test-token-1234",
};

describe("可视化 Demo 静态页面", () => {
  it("GET / 返回 HTML 且无需令牌", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("云端翻译可视化工作台");
    await app.close();
  });

  it("GET /styles.css 返回 CSS 且无需令牌", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/styles.css" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.body).toContain("--panel-bg");
    await app.close();
  });

  it("GET /app.js 返回 JavaScript 且无需令牌", async () => {
    const app = await buildServer(loadConfig(testEnv));
    const response = await app.inject({ method: "GET", url: "/app.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.body).toContain("fetch");
    await app.close();
  });
});

describe("isDemoPath", () => {
  it("识别根路径为 Demo 路径", () => {
    expect(isDemoPath("/")).toBe(true);
  });

  it("识别静态资源路径为 Demo 路径", () => {
    expect(isDemoPath("/styles.css")).toBe(true);
    expect(isDemoPath("/app.js")).toBe(true);
  });

  it("业务路径不是 Demo 路径", () => {
    expect(isDemoPath("/v1/translate")).toBe(false);
    expect(isDemoPath("/health")).toBe(false);
  });
});