import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { corpusConfigSchema } from "@corpus/contract";
import { option } from "./args";
import type { RunContext } from "./cli";
import { CliError, CONFIG_FILENAMES } from "./config";

export const INIT_USAGE =
  "corpus init --project <slug> --source <lang> --languages <a,b> --messages <path with {lang}> [--server <url>] [--type <name>]";

// `corpus init` writes a corpus.config.ts from flags alone, so it scripts;
// it validates the config before writing and never overwrites one.
export async function init(args: string[], ctx: RunContext): Promise<number> {
  const existing = CONFIG_FILENAMES.find((name) =>
    existsSync(path.join(ctx.cwd, name)),
  );
  if (existing) {
    throw new CliError(
      `${existing} already exists in ${ctx.cwd}; nothing written`,
    );
  }
  const required = (flag: string): string => {
    const value = option(args, flag);
    if (!value || value.startsWith("--")) {
      throw new CliError(`${flag} is required\nusage: ${INIT_USAGE}`);
    }
    return value;
  };
  const project = required("--project");
  const sourceLanguage = required("--source");
  const languages = required("--languages")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  const messages = required("--messages");
  const server = option(args, "--server") ?? "http://localhost:3000";
  const type = option(args, "--type") ?? "chrome";
  if (!messages.includes("{lang}")) {
    throw new CliError(
      `--messages must contain {lang}, such as src/i18n/{lang}.json`,
    );
  }
  const parsed = corpusConfigSchema.safeParse({
    project,
    server,
    sourceLanguage,
    languages,
    sources: [{ adapter: "messages", type, path: messages }],
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new CliError(`cannot write a valid config: ${issues}`);
  }
  const file = path.join(ctx.cwd, CONFIG_FILENAMES[0]);
  writeFileSync(file, render(parsed.data));
  ctx.out(`wrote ${CONFIG_FILENAMES[0]}`);
  ctx.out("");
  ctx.out("Next:");
  ctx.out(
    `  1. Create the project "${project}" in Corpus at ${server}/projects/new and copy its push token.`,
  );
  ctx.out("  2. export CORPUS_TOKEN=<token>");
  ctx.out("  3. corpus push");
  return 0;
}

function render(config: {
  project: string;
  server: string;
  sourceLanguage: string;
  languages: string[];
  sources: { adapter: string; type?: string; path?: string }[];
}): string {
  const q = (value: string) => JSON.stringify(value);
  const source = config.sources[0]!;
  return `import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: ${q(config.project)},
  server: ${q(config.server)},
  sourceLanguage: ${q(config.sourceLanguage)},
  languages: [${config.languages.map(q).join(", ")}],
  sources: [
    { adapter: "messages", type: ${q(source.type ?? "chrome")}, path: ${q(source.path ?? "")} },
  ],
});
`;
}
