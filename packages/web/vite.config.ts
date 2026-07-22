import { defineConfig } from "vite";

// The signed-in app is served under /app so it sits alongside the existing
// static marketing site at the root.
export default defineConfig({
  base: "/app/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
