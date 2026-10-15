import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

// The app under src, its design system under ui. H0_E2E=1 swaps the Tauri side (src/native.ts) for e2e/native.ts,
// so the bundle runs in a plain browser against the stub hub.
const root = import.meta.dirname;
const native = process.env.H0_E2E === "1" ? path.join(root, "e2e/native.ts") : path.join(root, "src/native.ts");

export default defineConfig({
  root,
  plugins: [react(), tailwind()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: "@/native", replacement: native },
      { find: "@h0/ui", replacement: path.join(root, "ui/src/index.ts") },
      { find: "@h0/transport", replacement: path.join(root, "../ui/js/contexts/api/transport.ts") },
      { find: "@", replacement: path.join(root, "src") },
    ],
    dedupe: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
  },
  // Fonts are the design system's.
  publicDir: path.join(root, "ui/public"),
  server: { port: 5470, strictPort: true, watch: { ignored: ["**/.e2e/**", "**/src-tauri/**"] } },
  build: { outDir: path.join(root, "dist"), emptyOutDir: true, target: "safari16" },
});
