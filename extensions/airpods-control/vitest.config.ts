import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.tsx"],
          environment: "happy-dom",
        },
      },
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["node_modules/", "src/test/", "**/*.test.{ts,tsx}", "**/*.d.ts", "**/*.config.*", "**/mock*"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@raycast/api": resolve(__dirname, "./src/test/mocks/raycast-api-mock.ts"),
      "@raycast/utils": resolve(__dirname, "./src/test/mocks/raycast-utils-mock.ts"),
    },
  },
});
