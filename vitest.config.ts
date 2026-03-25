import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
