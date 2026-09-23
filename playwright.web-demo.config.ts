import { defineConfig } from "@playwright/test";

const PORT = 4173;

/**
 * End-to-end coverage for the website-translation demo page.
 * Run `pnpm build:web-demo` first; the config reuses a running preview server
 * when one is already listening on the port.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "web-demo.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --config vite.web-demo.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
