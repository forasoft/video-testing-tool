import fs from "fs";
import path from "path";
import { defineConfig } from "vitest/config";

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../popup/public/manifest.json"), "utf8"));

// Mirrors the tsconfig "paths" so tests import modules the same way the sources do.
export default defineConfig({
  define: {
    __VTT_VERSION__: JSON.stringify(manifest.version),
  },
  resolve: {
    alias: [
      { find: /^src\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
      { find: /^shared\/(.*)$/, replacement: path.resolve(__dirname, "../shared/$1") },
      { find: /^(types|utils|wrappers|events|consts)(\/.*)?$/, replacement: path.resolve(__dirname, "src/$1$2") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
