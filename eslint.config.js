import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/.next/",
      "**/next-env.d.ts",
      "**/dist/",
      "coverage/",
      "**/test/fixtures/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts: the package build steps and the workbench's
    // CommonJS bin, which starts Next's CommonJS server.
    files: ["packages/*/build.mjs", "packages/*/bin/*.cjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
      },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
);
