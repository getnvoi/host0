import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Builds into the plane's embed. In dev, /api goes to a plane given by HZ_APP (https://app-<cluster>.<zone>),
// with the session cookie of a browser signed in there.
const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "js") } },
  server: {
    port: 5444,
    proxy: process.env.HZ_APP
      ? { "/api": { target: process.env.HZ_APP, changeOrigin: true, secure: true, ws: true } }
      : undefined,
  },
  build: { outDir: path.join(root, "../controlplane/web/dist"), emptyOutDir: true },
});
