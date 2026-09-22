import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  corpusConfigSchema,
  LANGUAGE_RE,
  LIBRARIES,
  localeOf,
  type Library,
} from "@corpus/contract";
import { option } from "./args";
import { readEntries } from "./build";
import { EXTENSIONS } from "./check";
import type { RunContext } from "./cli";
import { CliError, CONFIG_FILENAMES } from "./config";
import { ignoreCorpusDir } from "./corpus-dir";

export const INIT_USAGE =
  "corpus init --project <slug> --source <lang> --messages <path with {lang}> [--languages <a,b>] [--server <url>] [--type <name>] [--library <icu|i18next|vue>]";

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
  const messages = required("--messages");
  const server = option(args, "--server") ?? "http://localhost:3000";
  const type = option(args, "--type") ?? "chrome";
  if (!messages.includes("{lang}")) {
    throw new CliError(
      `--messages must contain {lang}, such as src/i18n/{lang}.json`,
    );
  }
  // The flag given without a value is an error, as for every option
  // (args.ts); only its absence means "read the files".
  const present = args.includes("--languages");
  const given = option(args, "--languages");
  const listed =
    given === undefined || given.startsWith("--")
      ? []
      : given
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean);
  if (present && listed.length === 0) {
    throw new CliError(`--languages needs a value\nusage: ${INIT_USAGE}`);
  }
  const languages = present
    ? listed
    : languagesFromFiles(ctx.cwd, messages, sourceLanguage);
  if (languages.length === 0) {
    throw new CliError(
      `no ${messages} file to take the languages from; pass --languages`,
    );
  }
  for (const code of languages) {
    if (!knownLanguage(code)) {
      ctx.err(
        `corpus: ${code} is not a language tag the runtime knows; kept, but check it is a language and not a tool's pseudo-locale`,
      );
    }
  }
  const library = await libraryFor(
    args,
    ctx.cwd,
    messages,
    sourceLanguage,
    type,
    ctx,
  );
  const include = checkIncludeFor(ctx.cwd);
  const parsed = corpusConfigSchema.safeParse({
    project,
    server,
    sourceLanguage,
    languages,
    sources: [
      {
        adapter: "messages",
        type,
        path: messages,
        ...(library && library.value !== "icu"
          ? { library: library.value }
          : {}),
      },
    ],
    ...(include ? { check: { include } } : {}),
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
  if (library && library.value !== "icu") {
    const why =
      library.value === "i18next" ? "{{ }}" : "a pipe or a quoted literal";
    ctx.out(
      `library: ${library.value}${library.detected ? `, from ${why} in ${library.detected}` : ""}`,
    );
  }
  if (include) {
    ctx.out(
      `check: ${include.join(", ")}, the directories holding components, so corpus check scans them`,
    );
  }
  const ignored = ignoreCorpusDir(ctx.cwd);
  if (ignored) ctx.out(ignored);
  ctx.out("");
  ctx.out("Next:");
  ctx.out(
    `  1. corpus workbench (needs @corpus-tool/workbench) starts an instance, creates the project "${project}" and writes its token to .corpus/token.`,
  );
  ctx.out(
    `     For another instance at ${server}: CORPUS_INVITE_SECRET=<its secret> corpus project create prints the token, for CORPUS_TOKEN or .corpus/token.`,
  );
  ctx.out("  2. corpus push");
  return 0;
}

function render(config: {
  project: string;
  server: string;
  sourceLanguage: string;
  languages: string[];
  sources: {
    adapter: string;
    type?: string;
    path?: string;
    library?: Library;
  }[];
  check?: { include?: string[] };
}): string {
  const q = (value: string) => JSON.stringify(value);
  const source = config.sources[0]!;
  const library = source.library ? `, library: ${q(source.library)}` : "";
  const check = config.check?.include
    ? `  check: { include: [${config.check.include.map(q).join(", ")}] },\n`
    : "";
  return `import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: ${q(config.project)},
  server: ${q(config.server)},
  sourceLanguage: ${q(config.sourceLanguage)},
  languages: [${config.languages.map(q).join(", ")}],
  sources: [
    { adapter: "messages", type: ${q(source.type ?? "chrome")}, path: ${q(source.path ?? "")}${library} },
  ],
${check}});
`;
}

// Where components live, in the roots the trials met (#498): Outline's
// are in app/ and shared/, Jellyfin's and Vikunja's in src/. A root
// counts when a file check reads is somewhere under it. `src` alone
// is what check scans by default, so it is not written.
const CHECK_ROOTS = ["src", "app", "lib", "components", "shared"] as const;
const CHECK_DEFAULT = ["src"];

function checkIncludeFor(cwd: string): string[] | undefined {
  const found = CHECK_ROOTS.filter((root) =>
    holdsCheckedFile(path.join(cwd, root)),
  );
  if (found.length === 0) return undefined;
  if (found.length === 1 && found[0] === CHECK_DEFAULT[0]) return undefined;
  return found;
}

function holdsCheckedFile(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (holdsCheckedFile(path.join(dir, entry.name))) return true;
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      return true;
    }
  }
  return false;
}

const ICU_ARGUMENT_RE = /\{\s*[^{},]+\s*,\s*(?:select|plural)\s*,/;
// Any ICU argument, not only the branching ones: a `{when, date, short}`
// in a catalogue with a stray pipe is still ICU, not vue-i18n.
const ICU_ANY_ARGUMENT_RE = /\{\s*[^{},]+\s*,\s*[a-z]+/;

// A source file that is absent or does not read decides nothing: push
// will say what is wrong with it.
async function libraryFor(
  args: string[],
  cwd: string,
  pattern: string,
  sourceLanguage: string,
  type: string,
  ctx: RunContext,
): Promise<{ value: Library; detected?: string } | undefined> {
  if (args.includes("--library") && args.includes("--syntax")) {
    throw new CliError(
      `--library and --syntax are the same flag under two names; pass --library\nusage: ${INIT_USAGE}`,
    );
  }
  const flag = args.includes("--library")
    ? "--library"
    : args.includes("--syntax")
      ? "--syntax"
      : undefined;
  if (flag) {
    if (flag === "--syntax") {
      ctx.err("corpus: --syntax is the old name for --library; it goes at 1.0");
    }
    const given = option(args, flag);
    if (!(LIBRARIES as readonly string[]).includes(given ?? "")) {
      throw new CliError(
        `${flag} takes ${LIBRARIES.join(", ")}\nusage: ${INIT_USAGE}`,
      );
    }
    return { value: given as Library };
  }
  const file = pattern.replace("{lang}", sourceLanguage);
  let texts: string[];
  try {
    const entries = await readEntries(createJiti(import.meta.url), cwd, file, {
      adapter: "messages",
      type,
      path: pattern,
    });
    texts = entries.map((entry) => entry.source);
  } catch {
    return undefined;
  }
  const braces = texts.some((text) => text.includes("{{"));
  const icu = texts.some((text) => ICU_ARGUMENT_RE.test(text));
  if (braces && !icu) return { value: "i18next", detected: file };
  // vue-i18n: a top-level pipe separates plural forms and `{'…'}` is a
  // literal. Either is enough, and neither appears in plain ICU.
  // A quoted literal is vue-i18n's alone. A pipe is only evidence when
  // nothing else in the catalogue reads as ICU, since a pipe is
  // ordinary punctuation.
  const escapes = texts.some((text) => /\{'[^']*'\}/.test(text));
  const pipes = texts.some((text) => text.includes("|"));
  const anyIcu = texts.some((text) => ICU_ANY_ARGUMENT_RE.test(text));
  if (!braces && !icu && (escapes || (pipes && !anyIcu))) {
    return { value: "vue", detected: file };
  }
  return undefined;
}

// The languages a messages path names (§3): every file or directory
// that fills its {lang}, the source first, so a repository that already
// carries its catalogues is not asked to list them by hand.
export function languagesFromFiles(
  cwd: string,
  pattern: string,
  sourceLanguage: string,
): string[] {
  const at = pattern.indexOf("{lang}");
  const before = pattern.slice(0, at);
  const after = pattern.slice(at + "{lang}".length);
  const dir = path.join(cwd, path.dirname(`${before}x`));
  const prefix = path.basename(`${before}x`).slice(0, -1);
  const afterFirst = after.split("/")[0] ?? "";
  const found = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(afterFirst)) continue;
    const code = name.slice(prefix.length, name.length - afterFirst.length);
    // A glossary or a fixture beside the catalogues is not a language.
    if (!LANGUAGE_RE.test(code)) continue;
    const rest =
      pattern.slice(0, at + "{lang}".length).replace("{lang}", code) + after;
    if (existsSync(path.join(cwd, rest))) found.add(code);
  }
  const rest = [...found].filter((c) => c !== sourceLanguage).sort();
  return found.size > 0 ? [sourceLanguage, ...rest] : [];
}

// Whether the runtime has locale data for a tag: a pseudo-locale a
// translation tool exports (Crowdin's `cr`) passes the tag's grammar
// but has none.
function knownLanguage(code: string): boolean {
  try {
    return Intl.PluralRules.supportedLocalesOf([localeOf(code)]).length > 0;
  } catch {
    return false;
  }
}
