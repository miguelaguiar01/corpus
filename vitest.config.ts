import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      // Workspace packages resolve through node conditions in the default
      // environment but not under jsdom; point straight at the sources.
      "@corpus/contract": fileURLToPath(
        new URL("./packages/contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.tsx",
      "packages/*/src/**/*.test.ts",
    ],
  },
});
