const { defineConfig } = require("eslint/config");
const n = require("eslint-plugin-n");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([
  ...raycastConfig,
  {
    plugins: {
      n,
    },
    rules: {
      "n/prefer-node-protocol": "error",
    },
  },
]);
