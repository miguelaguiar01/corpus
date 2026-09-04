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
  prettier,
);
