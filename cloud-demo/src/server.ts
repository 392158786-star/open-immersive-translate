import { pathToFileURL } from "node:url";
import { buildServer } from "./app.ts";
import { loadConfig } from "./config.ts";

export async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, "正在关闭云端 API 服务。");
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await app.listen({ host: config.host, port: config.port });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}