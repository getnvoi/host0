// The desktop app's UI tests: the web bundle (built with H0_E2E=1, so e2e/native.ts stands in for Tauri) in headless
// WebKit, against the stub hub (e2e/hub.ts) answering from e2e/recorded. Results go to .e2e/.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5471);
export const hubPort = Number(process.env.HUB_PORT ?? 5481);

export default defineConfig({
  testDir: "e2e/tests",
  outputDir: ".e2e/results",
  // One stub hub holds one scenario at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } }],
  webServer: [
    {
      command: `bun e2e/hub.ts`,
      url: `http://127.0.0.1:${hubPort}/__log`,
      env: { HUB_PORT: String(hubPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `bunx vite build --outDir .e2e/app --emptyOutDir --logLevel warn && bunx vite preview --outDir .e2e/app --host 127.0.0.1 --port ${port} --strictPort`,
      url: `http://127.0.0.1:${port}`,
      env: { H0_E2E: "1", VITE_H0_HUB: `http://127.0.0.1:${hubPort}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
