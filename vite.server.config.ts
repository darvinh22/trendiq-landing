import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "dist-server",
    ssr: resolve(__dirname, "src/server/runtime/server.ts"),
    target: "node20",
    rollupOptions: {
      output: {
        entryFileNames: "server.mjs",
      },
    },
  },
});
