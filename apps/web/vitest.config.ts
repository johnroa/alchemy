import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@alchemy/contracts": path.resolve(__dirname, "../../packages/contracts/src/generated.ts"),
      "@alchemy/shared/index": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@alchemy/shared/ingredient-icon-key": path.resolve(
        __dirname,
        "../../packages/shared/src/ingredient-icon-key.ts"
      )
    }
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"]
  }
});
