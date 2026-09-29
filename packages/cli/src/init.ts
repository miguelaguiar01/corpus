import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  isChromeMessages,
  parseXcstrings,
  yamlStrings,
  stripBom,
  xcstringsLanguages,
} from "@corpus/adapters";
import {
  corpusConfigSchema,
  LANGUAGE_RE,
  LIBRARIES,
  localeOf,
  parseIcu,
  posixTag,
  tagMode,
  type Library,
} from "@corpus/contract";
import { headOf, isQtLinguist, unreadableFile } from "./catalogue-format";
import { option } from "./args";
import {
  configKey,
  fileOf,
  readEntries,
  sourceLibrary,
  type FileSource,
} from "./build";
import { DEFAULT_INCLUDE, EXTENSIONS, SKIP_DIRS } from "./check";
import type { RunContext } from "./cli";
import {
  CliError,
  CONFIG_FILENAMES,
  matchPattern,
  namespacesOf,
} from "./config";
import { ignoreCorpusDir } from "./corpus-dir";

export const INIT_USAGE =
  "corpus init --project <slug> --source <lang> --messages <path with {lang}, or a .xcstrings> [--languages <a,b>] [--server <url>] [--type <name>] [--library <icu|i18next|vue|printf|chrome|counterpart|easy_localization|rails|qt>]";

// `corpus init` writes the config from flags alone, so it scripts;
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
  // A String Catalog holds every language in one file (#729): its path
  // has no {lang}, and it names its own source language, so --source
  // is optional for it alone.
  const named = option(args, "--messages");
  const catalogued = named !== undefined && /\.xcstrings$/i.test(named);
  if (catalogued && named.includes("{lang}"))
    throw new CliError(
      `--messages ${named}: a String Catalog holds every language in one file, so its path has no {lang}`,
    );
  const sourceFlag = catalogued
    ? option(args, "--source")
    : required("--source");
  if (
    sourceFlag?.startsWith("--") ||
    (catalogued && sourceFlag === undefined && args.includes("--source"))
  )
    throw new CliError(`--source needs a value\nusage: ${INIT_USAGE}`);
  const messages = required("--messages");
  const catalog = catalogued ? readCatalog(ctx.cwd, messages) : undefined;
  const sourceLanguage = sourceFlag ?? catalog!.sourceLanguage;
  if (catalog && sourceLanguage !== catalog.sourceLanguage)
    throw new CliError(
      `--source ${sourceLanguage}: ${messages} names ${catalog.sourceLanguage} as its source language`,
    );
  const server = option(args, "--server") ?? "http://localhost:3000";
  const type = option(args, "--type") ?? "ui";
  if (!catalog && !messages.includes("{lang}")) {
    throw new CliError(
      `--messages must contain {lang}, such as src/i18n/{lang}.json`,
    );
  }
  const { adapter, sourcePath } = formatOf(
    ctx,
    messages,
    sourceLanguage,
    catalog !== undefined,
  );
  // An XLIFF unit's text is ICU, and a flag that cannot apply is refused
  // rather than dropped.
  if (
    adapter === "xliff" &&
    (args.includes("--library") || args.includes("--syntax"))
  )
    throw new CliError(
      `--library does not apply to an xliff source: its text is ICU\nusage: ${INIT_USAGE}`,
    );
  const files =
    catalog || messages.includes("{ns}")
      ? { languages: [], languageFiles: {}, skipped: [] }
      : catalogueLanguages(ctx.cwd, messages, sourceLanguage);
  // Beside a JSON catalogue a file that names no language is a glossary
  // or a fixture, not a catalogue left out, unless its name carries a
  // POSIX modifier (`ca@valencia`), which only a language's does.
  const unnamed =
    adapter === "messages"
      ? files.skipped.filter((file) => path.basename(file).includes("@"))
      : files.skipped;
  if (unnamed.length > 0)
    ctx.err(
      `corpus: ${unnamed.join(", ")} ${unnamed.length === 1 ? "names" : "name"} no language tag and no script; left out, or map ${unnamed.length === 1 ? "it" : "each"} with languageFiles`,
    );
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
    : catalog
      ? catalog.languages
      : messages.includes("{ns}")
        ? namespacedLanguages(ctx.cwd, messages, sourceLanguage)
        : files.languages;
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
  // Only the messages adapter's library is detected; every other format
  // has its default, which only the flag changes, and xliff's is fixed.
  const detected =
    adapter === "xliff" ||
    (adapter !== "messages" &&
      !args.includes("--library") &&
      !args.includes("--syntax"))
      ? {}
      : await libraryFor(args, ctx.cwd, messages, sourceLanguage, type, ctx);
  const library = detected.library;
  const components = checkIncludeFor(ctx.cwd, messages);
  const include = components.include;
  // The mappings of the languages the config lists, given or read.
  const kept = Object.fromEntries(
    Object.entries(files.languageFiles).filter(([tag]) =>
      languages.includes(tag),
    ),
  );
  const source: InitSource = {
    adapter,
    type,
    path: messages,
    ...(sourcePath && { sourcePath }),
    ...(library &&
      (adapter !== "messages" || library.value !== "icu") && {
        library: library.value,
      }),
    ...(Object.keys(kept).length > 0 && { languageFiles: kept }),
  };
  // A Rails YAML catalogue is HTML the server renders, so a source
  // whose tags only HTML reads builds with its type read so; any other
  // catalogue's tags may be components, I18n.js's JSON's too, and init
  // only says it (#952).
  const htmlTags = await htmlOnlyTags(ctx.cwd, source, sourceLanguage);
  const readAsHtml =
    htmlTags > 0 &&
    adapter === "yaml" &&
    sourceLibrary(source as FileSource) === "rails";
  const config: InitConfig = {
    project,
    server,
    sourceLanguage,
    languages,
    sources: [source],
    ...(readAsHtml && { richText: { [type]: "html" as const } }),
    ...(include && { check: { include } }),
  };
  const parsed = corpusConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new CliError(`cannot write a valid config: ${issues}`);
  }
  // The typed file imports the package from the repository; when it is
  // not installed there (the CLI run from npx, #598), the next command
  // could not load it, so a plain module is written instead.
  const plain = !cliResolvesFrom(ctx.cwd);
  const filename = plain ? "corpus.config.mjs" : CONFIG_FILENAMES[0];
  // The pattern is written as given: `{ns}` stays `{ns}` in the file.
  writeFileSync(path.join(ctx.cwd, filename), render(plain, config));
  ctx.out(
    plain
      ? `wrote ${filename} (a plain object: @corpus-tool/cli is not installed in this repository)`
      : `wrote ${filename}`,
  );
  if (library && (library.value !== "icu" || adapter !== "messages")) {
    const why = library.detected && DETECTED_BY[library.value];
    ctx.out(
      `library: ${library.value}${why ? `, from ${why} in ${library.detected}` : ""}`,
    );
  }
  if (detected.note) ctx.out(detected.note);
  if (adapter === "yaml" && !library)
    ctx.out("library: rails (the yaml source's default)");
  if (readAsHtml)
    ctx.out(
      `richText: ${type} is read as HTML: ${htmlTags} source string(s) hold tags only HTML takes as text, an unclosed tag or a lone <br>`,
    );
  else if (htmlTags > 0)
    ctx.out(
      `corpus: ${htmlTags} source string(s) hold tags only HTML takes as text, an unclosed tag or a lone <br>, and are refused as they are: if the app renders ${type} as HTML, add richText: { ${configKey(type)}: "html" } to ${filename}`,
    );
  if (include) {
    ctx.out(
      `check.include: ${include.join(", ")} (the directories holding components, which corpus check scans)`,
    );
  } else if (!components.found) {
    ctx.out(
      `check.include: init found no components where it looks; corpus check scans src, so set check.include in ${filename} to where they are`,
    );
  }
  const siblings =
    adapter === "messages"
      ? siblingCatalogues(ctx.cwd, messages, sourceLanguage)
      : [];
  if (siblings.length > 0) {
    ctx.out(
      `corpus: ${messages.replaceAll("{lang}", sourceLanguage)} has ${siblings.length} sibling catalogue(s) the pattern does not name (${siblings.slice(0, 3).join(", ")}${siblings.length > 3 ? ", …" : ""}); a {ns} pattern or an array of paths names them all`,
    );
  }
  const ignored = ignoreCorpusDir(ctx.cwd);
  if (ignored) ctx.out(ignored);
  nextSteps(ctx, project, server, option(args, "--server") === undefined);
  return 0;
}

type InitSource = {
  adapter: "messages" | "xliff" | "gettext" | "xcstrings" | "qt-ts" | "yaml";
  type: string;
  path: string;
  sourcePath?: string;
  library?: Library;
  languageFiles?: Record<string, string>;
};

type InitConfig = {
  project: string;
  server: string;
  sourceLanguage: string;
  languages: string[];
  sources: [InitSource];
  richText?: Record<string, "html">;
  check?: { include: string[] };
};

// How many of the source file's strings are refused as the library
// reads their tags and taken as text where the type is read as HTML
// (#952); none where the file will not read, which build then says.
async function htmlOnlyTags(
  cwd: string,
  source: InitSource,
  sourceLanguage: string,
): Promise<number> {
  const declared = source as FileSource;
  let entries;
  try {
    entries = await readEntries(
      createJiti(import.meta.url),
      cwd,
      fileOf(declared, sourceLanguage, sourceLanguage),
      declared,
      true,
      sourceLanguage,
    );
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const library = entry.library ?? sourceLibrary(declared);
    if (
      !parseIcu(entry.source, library, { html: tagMode(library) }).ok &&
      parseIcu(entry.source, library, { html: "markup" }).ok
    )
      count += 1;
  }
  return count;
}

// What each library init detects is told by, for the line that says so.
const DETECTED_BY: Partial<Record<Library, string>> = {
  i18next: "{{ }}",
  printf: "printf verbs",
  chrome: "the Chrome i18n shape",
  counterpart: "%(name)s placeholders",
  easy_localization: "{} placeholders or @:key links",
  rails: "%{name} placeholders",
  vue: "a pipe or a quoted literal",
};

// The adapter the pattern's files take, told by their extension and,
// for a `.ts`, their first bytes; a file the format needs and cannot
// find is warned of, and one its adapter cannot read refused.
function formatOf(
  ctx: RunContext,
  messages: string,
  sourceLanguage: string,
  catalogued: boolean,
): { adapter: InitSource["adapter"]; sourcePath?: string } {
  if (catalogued) return { adapter: "xcstrings" };
  const sourceFile = path.join(
    ctx.cwd,
    messages.replaceAll("{lang}", sourceLanguage),
  );
  const missing = !existsSync(sourceFile);
  const relative = path.relative(ctx.cwd, sourceFile);
  // XLIFF has its own adapter (#712); Angular names the source-language
  // file with no language in it, `messages.xlf` beside `messages.de.xlf`.
  if (/\.(?:xlf|xliff)$/i.test(messages)) {
    refuseNamespace(messages, "xliff");
    // Angular's file with no language in its name, guessed where one
    // {lang} names the language; two leave no name to guess.
    const bare =
      messages.split("{lang}").length === 2
        ? path.posix.normalize(messages.replace(/[._-]?\{lang\}/, ""))
        : undefined;
    const sourcePath =
      missing && bare !== undefined && existsSync(path.join(ctx.cwd, bare))
        ? bare
        : undefined;
    if (!sourcePath && missing)
      ctx.err(
        bare === undefined
          ? `corpus: no ${relative}; set the xliff source's sourcePath to the file Angular extracts`
          : `corpus: no ${relative} and no ${bare}; set the xliff source's sourcePath to the file Angular extracts`,
      );
    return { adapter: "xliff", ...(sourcePath && { sourcePath }) };
  }
  // gettext too (#720): xgettext's `.pot` beside the `.po` files is the
  // source, when there is one.
  if (/\.po$/i.test(messages)) {
    refuseNamespace(messages, "gettext");
    const templates = potsBeside(ctx.cwd, messages);
    if (templates.length > 1)
      ctx.err(
        `corpus: ${templates.join(", ")} sit beside the catalogues; set the gettext source's sourcePath to the one xgettext writes`,
      );
    else if (templates.length === 0 && missing)
      ctx.err(
        `corpus: no .pot beside the catalogues and no ${relative}; set the gettext source's sourcePath to the template xgettext writes`,
      );
    return {
      adapter: "gettext",
      ...(templates.length === 1 && { sourcePath: templates[0] }),
    };
  }
  // Rails I18n's YAML (#754): one file per language, rooted at its code.
  // Any other YAML (Symfony's, Hugo's) is refused here, by what it holds,
  // rather than written into a config that cannot build.
  if (/\.ya?ml$/i.test(messages)) {
    refuseNamespace(messages, "yaml");
    if (missing)
      throw new CliError(
        `--messages ${messages}: no ${relative} to read the source language's strings from`,
      );
    try {
      yamlStrings(readFileSync(sourceFile, "utf8"), sourceLanguage, {
        source: true,
      });
    } catch (error) {
      throw new CliError(
        `--messages ${messages}: a YAML catalogue the yaml source cannot read (${(error as Error).message}); it reads Rails I18n's layout, rooted at the language, and an exec source converts any other`,
      );
    }
    return { adapter: "yaml" };
  }
  // Qt Linguist's XML under a `.ts` name (#742), told from TypeScript by
  // its first bytes, of the files the pattern names alone, never a
  // TypeScript file beside them (#749).
  const qt =
    /\.ts$/i.test(messages) &&
    (!missing
      ? isQtLinguist(headOf(sourceFile))
      : (messages.includes("{ns}")
          ? matchPattern(ctx.cwd, messages).map((m) => m.file)
          : patternFiles(ctx.cwd, messages)
        ).some((file) => isQtLinguist(headOf(path.join(ctx.cwd, file)))));
  if (qt) {
    refuseNamespace(messages, "qt-ts");
    // lupdate's template, `app.ts` beside `app_de.ts`, is the source where
    // the source language has no file of its own (#749).
    const sourcePath = missing ? qtTemplateOf(ctx.cwd, messages) : undefined;
    if (missing && !sourcePath)
      ctx.err(
        `corpus: no ${relative}; set the qt-ts source's sourcePath to the template lupdate writes`,
      );
    return { adapter: "qt-ts", ...(sourcePath && { sourcePath }) };
  }
  // Every format's build reads the source language's file (#856).
  if (
    messages.includes("{ns}")
      ? matchPattern(ctx.cwd, messages, sourceLanguage).length === 0
      : missing
  )
    ctx.err(
      `corpus: no ${relative}: build reads the source language's strings from it`,
    );
  const unreadable = unreadableFile(sourceFile);
  if (unreadable) throw new CliError(`--messages ${messages}: ${unreadable}`);
  return { adapter: "messages" };
}

function nextSteps(
  ctx: RunContext,
  project: string,
  server: string,
  defaultServer: boolean,
) {
  ctx.out("");
  ctx.out("Next:");
  ctx.out(
    `  1. corpus workbench (needs @corpus-tool/workbench) starts an instance, creates the project "${project}" and writes its token to .corpus/token.`,
  );
  if (defaultServer) {
    ctx.out(
      `     The config's server is ${server}: corpus workbench listens there by default; for another port, edit the config or run init with --server.`,
    );
  }
  ctx.out(
    `     For another instance at ${server}: CORPUS_INVITE_SECRET=<its secret> corpus project create prints the token, for CORPUS_TOKEN or .corpus/token.`,
  );
  ctx.out("  2. corpus push");
}

// Node's own walk: a node_modules holding the package in the repository
// or any directory above it, which is what the typed file's import sees.
function cliResolvesFrom(cwd: string): boolean {
  let dir = path.resolve(cwd);
  for (;;) {
    if (
      existsSync(path.join(dir, "node_modules/@corpus-tool/cli/package.json"))
    )
      return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function render(plain: boolean, config: InitConfig): string {
  const q = (value: string) => JSON.stringify(value);
  const [source] = config.sources;
  const library = source.library ? `, library: ${q(source.library)}` : "";
  const check = config.check
    ? `  check: { include: [${config.check.include.map(q).join(", ")}] },\n`
    : "";
  const richText = config.richText
    ? `  richText: { ${Object.entries(config.richText)
        .map(([type, value]) => `${configKey(type)}: ${q(value)}`)
        .join(", ")} },\n`
    : "";
  const body = `  project: ${q(config.project)},
  server: ${q(config.server)},
  sourceLanguage: ${q(config.sourceLanguage)},
  languages: [${config.languages.map(q).join(", ")}],
  sources: [
    { adapter: ${q(source.adapter)}, type: ${q(source.type)}, path: ${q(source.path)}${source.sourcePath ? `, sourcePath: ${q(source.sourcePath)}` : ""}${library}${
      source.languageFiles
        ? `, languageFiles: { ${Object.entries(source.languageFiles)
            .map(([tag, code]) => `${q(tag)}: ${q(code)}`)
            .join(", ")} }`
        : ""
    } },
  ],
${richText}${check}`;
  return plain
    ? `export default {\n${body}};\n`
    : `import { defineCorpus } from "@corpus-tool/cli";\n\nexport default defineCorpus({\n${body}});\n`;
}

// Where components live, in the roots the trials met (#498): Outline's
// are in app/ and shared/, Jellyfin's and Vikunja's in src/. A root
// counts when a file check reads is somewhere under it. `src` alone
// is what check scans by default, so it is not written.
const CHECK_ROOTS = ["src", "app", "lib", "components", "shared"] as const;

// A monorepo keeps them deeper (#655): Hoppscotch's are in
// packages/hoppscotch-common/src/components, so without a root that
// holds them the `components` directories to four levels down count,
// and without those the roots of the catalogue's own package.
const COMPONENT_DEPTH = 4;
const PACKAGE_ROOTS = ["src", "app", "pages", "components"] as const;

function checkIncludeFor(
  cwd: string,
  messages: string,
): { include?: string[]; found: boolean } {
  const found = CHECK_ROOTS.filter((root) =>
    holdsCheckedFile(path.join(cwd, root)),
  );
  if (found.length > 0) {
    const isDefault =
      found.length === DEFAULT_INCLUDE.length &&
      found.every((root, i) => root === DEFAULT_INCLUDE[i]);
    return { include: isDefault ? undefined : found, found: true };
  }
  const components = componentDirs(cwd, "", 0);
  if (components.length > 0) return { include: components, found: true };
  const pkg = packageOf(cwd, messages);
  if (pkg !== undefined) {
    const roots = PACKAGE_ROOTS.map((root) => `${pkg}/${root}`).filter((dir) =>
      holdsCheckedFile(path.join(cwd, dir)),
    );
    if (roots.length > 0) return { include: roots, found: true };
  }
  return { found: false };
}

function componentDirs(cwd: string, rel: string, depth: number): string[] {
  if (depth >= COMPONENT_DEPTH) return [];
  let entries;
  try {
    entries = readdirSync(path.join(cwd, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === "components" && holdsCheckedFile(path.join(cwd, child)))
      out.push(child);
    else out.push(...componentDirs(cwd, child, depth + 1));
  }
  return out;
}

// The package a catalogue belongs to: the nearest directory above its
// path, below the repository root, with a package.json.
function packageOf(cwd: string, messages: string): string | undefined {
  const relative = path.posix.normalize(messages.replaceAll("\\", "/"));
  if (relative.startsWith("/") || relative.startsWith("..")) return undefined;
  const fixed = relative.split("/");
  const at = fixed.findIndex((segment) => segment.includes("{"));
  let dir = fixed.slice(0, at < 0 ? -1 : at).join("/");
  while (dir !== "" && dir !== ".") {
    if (existsSync(path.join(cwd, dir, "package.json"))) return dir;
    dir = path.posix.dirname(dir);
  }
  return undefined;
}

// A symlinked directory is not followed: a Dirent reports it as a link,
// not a directory, which is what keeps a cycle from looping. `check`
// itself does follow links, so a tree reachable only through one is
// declared by hand.
function holdsCheckedFile(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (holdsCheckedFile(path.join(dir, entry.name))) return true;
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      return true;
    }
  }
  return false;
}

const ICU_ARGUMENT_RE = /\{\s*[^{},]+\s*,\s*(?:select|plural)\s*,/;
// The placeholder shapes a catalogue's strings are counted by (#591):
// i18next's {{ name }}, a single-brace {name}, and a printf verb.
const DOUBLE_BRACE_RE = /\{\{\s*[^{}]+\}\}/;
const COUNTERPART_RE = /%\([^()\s]+\)[sd]/;
const RAILS_RE = /%\{[^{}\s]+\}/;
const SINGLE_BRACE_RE = /(?<!\{)\{\s*[\p{L}_][\p{L}\p{M}\p{N}_.-]*\s*\}(?!\})/u;
// C's length modifiers and Objective-C's %@ count as verbs too (#614).
const PRINTF_RE =
  /%(?:\[\d+\]|\d+\$)?[-+0#]*\d*(?:\.\d+)?(?:hh|h|ll|l|z|j|t|L|q)?[sdvfxXqcbeEgGtTpu@]/;
const PLURAL_SUFFIX_RE = /_(?:zero|one|two|few|many|other)$/;
// Any ICU argument, not only the branching ones: a `{when, date, short}`
// in a catalogue with a stray pipe is still ICU, not vue-i18n.
const ICU_ANY_ARGUMENT_RE = /\{\s*[^{},]+\s*,\s*[a-z]+/;

function chromeShaped(file: string): boolean {
  if (!file.endsWith(".json")) return false;
  try {
    return isChromeMessages(JSON.parse(stripBom(readFileSync(file, "utf8"))));
  } catch {
    return false;
  }
}

// A source file that is absent or does not read decides nothing: push
// will say what is wrong with it.
async function libraryFor(
  args: string[],
  cwd: string,
  pattern: string,
  sourceLanguage: string,
  type: string,
  ctx: RunContext,
): Promise<{ library?: { value: Library; detected?: string }; note?: string }> {
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
    return { library: { value: given as Library } };
  }
  // A `{ns}` pattern is read through every namespace it captures, so
  // one namespace's plain strings do not hide another's interpolation.
  const concretes = pattern.includes("{ns}")
    ? namespacesOf(cwd, pattern, sourceLanguage).map((ns) =>
        pattern.replaceAll("{ns}", ns),
      )
    : [pattern];
  const file = concretes[0]?.replaceAll("{lang}", sourceLanguage) ?? pattern;
  let texts: string[];
  let ids: string[];
  let keyed = 0;
  try {
    const jiti = createJiti(import.meta.url);
    texts = [];
    ids = [];
    for (const concrete of concretes) {
      const entries = await readEntries(
        jiti,
        cwd,
        concrete.replaceAll("{lang}", sourceLanguage),
        { adapter: "messages", type, path: concrete },
        true,
      );
      texts.push(...entries.map((entry) => entry.source));
      ids.push(...entries.map((entry) => entry.id));
      keyed += entries.filter((entry) => entry.keyIsText).length;
    }
  } catch {
    return {};
  }
  if (concretes.length === 0) return {};
  const chrome = concretes.every((concrete) =>
    chromeShaped(path.join(cwd, concrete.replaceAll("{lang}", sourceLanguage))),
  );
  if (chrome) return { library: { value: "chrome", detected: file } };
  // Flutter's easy_localization (#664), counted like every shape: `{}`
  // is its positional placeholder, and `@:key` its link, which vue-i18n
  // writes too, so a link counts only where no vue sign, a quoted
  // literal or a pipe, is there.
  const escapes = texts.some((text) => /\{'[^']*'\}/.test(text));
  const pipes = texts.some((text) => text.includes("|"));
  const easy =
    texts.filter((text) => text.includes("{}")).length +
    (escapes || pipes
      ? 0
      : texts.filter((text) => /@(?:\.[a-z]+)?:[\w(]/.test(text)).length);
  const doubles = texts.filter((text) => DOUBLE_BRACE_RE.test(text)).length;
  const printf = texts.filter((text) => PRINTF_RE.test(text)).length;
  const argued = texts.filter(
    (text) =>
      SINGLE_BRACE_RE.test(text) ||
      PRINTF_RE.test(text) ||
      COUNTERPART_RE.test(text) ||
      (ICU_ARGUMENT_RE.test(text) && !text.includes("{}")),
  ).length;
  if (easy >= 2 && easy > argued && doubles === 0)
    return { library: { value: "easy_localization", detected: file } };
  // Rails I18n (#665): `%{name}`, whose braces would count as ICU's.
  const rails = texts.filter((text) => RAILS_RE.test(text)).length;
  const bare = texts.filter(
    (text) =>
      !RAILS_RE.test(text) &&
      !DOUBLE_BRACE_RE.test(text) &&
      SINGLE_BRACE_RE.test(text),
  ).length;
  if (rails >= 2 && rails > doubles + bare && rails > printf)
    return { library: { value: "rails", detected: file } };
  const singles = texts.filter(
    (text) => !DOUBLE_BRACE_RE.test(text) && SINGLE_BRACE_RE.test(text),
  ).length;
  const icu = texts.some((text) => ICU_ARGUMENT_RE.test(text));
  // Shapes are counted, not spotted: {{ }} names i18next when it
  // outnumbers the single-brace and the printf strings; one {{ }} among
  // four thousand printf strings is a template, not the library (#591).
  if (doubles > singles && doubles > printf && !icu)
    return { library: { value: "i18next", detected: file } };
  const noted = (note: string) => `${note} in ${file}`;
  // Ghost's shape (#589): the sentence is the key and the value is "".
  if (keyed > 0 && keyed * 2 >= texts.length) {
    return {
      note: noted(
        `source values are empty: the key is the text, and a proposal on those strings is refused`,
      ),
    };
  }
  // Element's matrix-web-i18n (#663): `%(name)s` names counterpart when
  // it outnumbers every other shape.
  const counterpart = texts.filter((text) => COUNTERPART_RE.test(text)).length;
  if (counterpart > doubles + singles && counterpart > printf)
    return { library: { value: "counterpart", detected: file } };
  if (printf > doubles + singles)
    return { library: { value: "printf", detected: file } };
  if (
    doubles === 0 &&
    singles > 0 &&
    ids.some((id) => PLURAL_SUFFIX_RE.test(id))
  ) {
    return {
      note: noted(
        "i18next keys with { } interpolation: read as icu, which checks the placeholders",
      ),
    };
  }
  // vue-i18n: a quoted literal is enough; a pipe only where nothing else
  // in the catalogue reads as ICU.
  const anyIcu = texts.some((text) => ICU_ANY_ARGUMENT_RE.test(text));
  if (doubles === 0 && !icu && (escapes || (pipes && !anyIcu))) {
    return { library: { value: "vue", detected: file } };
  }
  return {};
}

// Only messages, table and fluent read `{ns}` (#854).
function refuseNamespace(messages: string, adapter: string): void {
  if (messages.includes("{ns}"))
    throw new CliError(
      `--messages ${messages}: ${adapter} does not read {ns}: only messages, table and fluent do`,
    );
}

// The languages a `{ns}` pattern's files name, the source first.
function namespacedLanguages(
  cwd: string,
  pattern: string,
  sourceLanguage: string,
): string[] {
  const found = new Set(
    matchPattern(cwd, pattern)
      .map((m) => m.lang)
      .filter((code) => LANGUAGE_RE.test(code)),
  );
  const rest = [...found].filter((c) => c !== sourceLanguage).sort();
  return found.has(sourceLanguage) ? [sourceLanguage, ...rest] : [];
}

// Whether a tag names a language: one the runtime has plural rules for,
// or one CLDR has a name for, as it has for Karakalpak's `kaa`, Occitan
// and Latgalian's `ltg`, which have no plural rules there (#657). A
// pseudo-locale a translation tool exports is a real code it borrows
// (Crowdin's `cr`, Cree, and its in-context `ach`, Acoli), so those are
// said all the same.
const PSEUDO_LOCALES = new Set(["cr", "ach"]);
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});

function knownLanguage(code: string): boolean {
  const locale = localeOf(code);
  if (PSEUDO_LOCALES.has(locale.toLowerCase())) return false;
  try {
    if (Intl.PluralRules.supportedLocalesOf([locale]).length > 0) return true;
    const language = new Intl.Locale(locale).language;
    return LANGUAGE_NAMES.of(language) !== undefined;
  } catch {
    return false;
  }
}

// Other catalogues beside the one a single pattern names (#513): the
// one-file-per-namespace layout a pattern without {ns} leaves behind.
function siblingCatalogues(
  cwd: string,
  pattern: string,
  sourceLanguage: string,
): string[] {
  if (pattern.includes("{ns}")) return [];
  const file = pattern.replaceAll("{lang}", sourceLanguage);
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const glossary = /glossary/i;
  let names: string[];
  try {
    names = readdirSync(path.join(cwd, dir));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(ext) && name !== path.basename(file))
    .filter((name) => !glossary.test(name))
    .filter((name) => {
      // A sibling that is another language of the same pattern is not
      // a namespace: the pattern already names it. The language sits
      // between the basename's prefix and suffix around {lang}.
      const base = path.basename(pattern);
      const at = base.indexOf("{lang}");
      if (at < 0) return true;
      const prefix = base.slice(0, at);
      const suffix = base.slice(at + "{lang}".length);
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) return true;
      const code = name.slice(prefix.length, name.length - suffix.length);
      // A code with a POSIX modifier is a language's too, if no tag.
      return !LANGUAGE_RE.test(code) && !posixTag(code) && !code.includes("@");
    })
    .map((name) => path.join(dir, name))
    .sort();
}

// The `.pot` files in the directory above a `.po` pattern's language,
// `locales/` for `locales/{lang}.po` and GNU's
// `locales/{lang}/LC_MESSAGES/app.po` alike; the one named as the
// catalogues are (`app.pot`) alone when it is there.
function potsBeside(cwd: string, pattern: string): string[] {
  const dir = path.posix.dirname(
    `${pattern.slice(0, pattern.indexOf("{lang}"))}x`,
  );
  let pots: string[];
  try {
    pots = readdirSync(path.join(cwd, dir))
      .filter((name) => /\.pot$/i.test(name))
      .sort();
  } catch {
    return [];
  }
  const named = `${path.posix.basename(pattern, ".po")}.pot`;
  if (pots.includes(named)) pots = [named];
  return pots.map((name) => path.posix.normalize(path.posix.join(dir, name)));
}

// A String Catalog's source language and every language it holds, the
// source first.
function readCatalog(
  cwd: string,
  file: string,
): { sourceLanguage: string; languages: string[] } {
  let text: string;
  try {
    text = readFileSync(path.join(cwd, file), "utf8");
  } catch {
    throw new CliError(`--messages ${file}: no such file`);
  }
  try {
    return {
      sourceLanguage: parseXcstrings(text).sourceLanguage,
      languages: xcstringsLanguages(text),
    };
  } catch (error) {
    throw new CliError(`--messages ${file}: ${(error as Error).message}`);
  }
}

// The languages a catalogue's files name, the source first: a POSIX
// script modifier, `sr@latin`, is its tag `sr-Latn`, mapped back to the
// file's code through languageFiles (#657, #855); any other code that is
// no tag is skipped and named.
function catalogueLanguages(
  cwd: string,
  pattern: string,
  sourceLanguage: string,
): {
  languages: string[];
  languageFiles: Record<string, string>;
  skipped: string[];
} {
  const languageFiles: Record<string, string> = {};
  const found = new Set<string>();
  const skipped: string[] = [];
  for (const { code, file } of filesFilling(cwd, pattern)) {
    const tag = posixTag(code);
    if (tag) {
      languageFiles[tag] = code;
      found.add(tag);
    } else if (LANGUAGE_RE.test(code)) found.add(code);
    else skipped.push(file);
  }
  if (found.size === 0) return { languages: [], languageFiles, skipped };
  found.delete(sourceLanguage);
  return {
    languages: [sourceLanguage, ...[...found].sort()],
    languageFiles,
    skipped,
  };
}

// The files a pattern names, with the code each fills `{lang}` with:
// `{lang}` a part of a file's name or a directory.
function filesFilling(
  cwd: string,
  pattern: string,
): { code: string; file: string }[] {
  const at = pattern.indexOf("{lang}");
  const before = pattern.slice(0, at);
  const after = pattern.slice(at + "{lang}".length);
  const prefix = path.basename(`${before}x`).slice(0, -1);
  const afterFirst = after.split("/")[0] ?? "";
  let names: string[];
  try {
    names = readdirSync(path.join(cwd, path.dirname(`${before}x`)));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(afterFirst))
    .map((name) => {
      const code = name.slice(prefix.length, name.length - afterFirst.length);
      return { code, file: pattern.replaceAll("{lang}", code) };
    })
    .filter(({ file }) => existsSync(path.join(cwd, file)));
}

function patternFiles(cwd: string, pattern: string): string[] {
  return filesFilling(cwd, pattern).map(({ file }) => file);
}

// Whether a Qt file's `<TS>` names its language, in the file's first
// kilobyte, past the declaration and doctype.
function namesLanguage(file: string): boolean {
  const head = readFileSync(file, "utf8").slice(0, 1024);
  const open = /<TS\b[^>]*>/.exec(head)?.[0] ?? "";
  return /\slanguage\s*=\s*(["'])[^"']+\1/.test(open);
}

// lupdate's template beside a file-name pattern's catalogues: the one Qt
// file in their directory the pattern does not name whose `<TS>` names
// no language, as lupdate writes a template; another component's
// `qt_de.ts` names one.
function qtTemplateOf(cwd: string, pattern: string): string | undefined {
  const dir = path.posix.dirname(pattern);
  if (dir.includes("{lang}")) return undefined;
  const named = new Set(patternFiles(cwd, pattern));
  let names: string[];
  try {
    names = readdirSync(path.join(cwd, dir));
  } catch {
    return undefined;
  }
  const templates = names
    .map((name) => (dir === "." ? name : `${dir}/${name}`))
    .filter(
      (file) =>
        /\.ts$/i.test(file) &&
        !named.has(file) &&
        isQtLinguist(headOf(path.join(cwd, file))) &&
        !namesLanguage(path.join(cwd, file)),
    );
  return templates.length === 1 ? templates[0] : undefined;
}
