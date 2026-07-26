import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/.evidence/**",
      "**/.git/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  },
});
