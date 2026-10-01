import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      shared: path.resolve(__dirname, "../shared"),
    },
  },
  base: "./",
  build: {
    outDir: "build",
  },
  // `vite dev` serves ../shared and, for the dev mock, the injection's pure functions.
  server: {
    fs: {
      allow: [".."],
    },
  },
});
