import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@",
        replacement: path.resolve(__dirname, "."),
      },
      {
        find: /^@alchemy\/shared$/,
        replacement: path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      },
      {
        find: /^@alchemy\/shared\/(.+)$/,
        replacement: `${path.resolve(__dirname, "../../packages/shared/src")}/$1`,
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
