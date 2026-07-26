import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    exclude: [
      "**/.evidence/**",
      "**/.git/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  },
});
