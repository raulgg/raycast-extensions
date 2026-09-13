import raycastConfig from "@raycast/eslint-config";
import { defineConfig } from "eslint/config";
import importX from "eslint-plugin-import-x";

export default defineConfig([
  ...raycastConfig,
  {
    plugins: {
      "import-x": importX,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "never",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
    },
  },
]);
