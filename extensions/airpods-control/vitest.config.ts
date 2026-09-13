import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/test/integration/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["src/**/*.test.tsx"],
          environment: "happy-dom",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/test/integration/**/*.integration.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "macos",
          include: ["src/test/integration/**/*.macos.test.ts"],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["node_modules/**", "src/test/**", "**/*.test.{ts,tsx}", "**/*.d.ts", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@raycast/api": resolve(import.meta.dirname, "./src/test/mocks/raycast-api-mock.ts"),
      "@raycast/utils": resolve(import.meta.dirname, "./src/test/mocks/raycast-utils-mock.ts"),
    },
  },
});
