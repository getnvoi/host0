import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.join(import.meta.dirname, "js") } },
  test: { environment: "jsdom", globals: true, setupFiles: ["js/test/setup.ts"], include: ["js/**/*.test.{ts,tsx}"] },
});
