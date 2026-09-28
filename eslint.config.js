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
      // Agent worktrees are whole checkouts of the repository; the
      // prettier ignore has the same line.
      ".claude/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts: the package build steps, the workbench's
    // CommonJS bin, which starts Next's CommonJS server, and the
    // repository's own scripts under bin/, and the wiki's example
    // exporter and importer.
    files: [
      "packages/*/build.mjs",
      "packages/*/bin/*.cjs",
      "bin/*.mjs",
      "docs/wiki/examples/*.mjs",
    ],
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
