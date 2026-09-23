import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const WEB_DIR = fileURLToPath(new URL("../../web", import.meta.url));

interface DemoAsset {
  filePath: string;
  contentType: string;
}

const ASSETS: Record<string, DemoAsset> = {
  "/": {
    filePath: join(WEB_DIR, "index.html"),
    contentType: "text/html; charset=utf-8",
  },
  "/styles.css": {
    filePath: join(WEB_DIR, "styles.css"),
    contentType: "text/css; charset=utf-8",
  },
  "/app.js": {
    filePath: join(WEB_DIR, "app.js"),
    contentType: "application/javascript; charset=utf-8",
  },
};

/** Demo 静态页面路径，无需 Bearer Token 即可访问。 */
export function isDemoPath(url: string): boolean {
  const path = url.split("?")[0];
  return path in ASSETS;
}

/**
 * 注册可视化 Demo 的静态页面路由。
 * 在启动时一次性读入 web 目录下的文件并缓存，避免每次请求都访问磁盘。
 */
export function registerDemoRoute(app: FastifyInstance): void {
  for (const [route, asset] of Object.entries(ASSETS)) {
    const content = readFileSync(asset.filePath, "utf8");
    app.get(route, async (_request, reply) => {
      reply.type(asset.contentType);
      return content;
    });
  }
}