import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { androidDirOf, keyIsSentence, stripBom } from "@corpus/adapters";
import {
  corpusConfigSchema,
  type CorpusConfig,
  type CorpusInput,
  type Source,
} from "@corpus/contract";
import { CORPUS_DIR, TOKEN_FILE, tokenPath } from "./corpus-dir";

// In the order they are looked for.
export const CONFIG_FILENAMES = [
  "corpus.config.ts",
  "corpus.config.mts",
  "corpus.config.js",
  "corpus.config.mjs",
] as const;

export class CliError extends Error {}

function configPathOf(cwd: string): string | undefined {
  return CONFIG_FILENAMES.map((name) => path.join(cwd, name)).find(
    (candidate) => existsSync(candidate),
  );
}

// The config's file name as the repository has it, for a message that
// says where to set something (#655).
export function configFileName(cwd: string): string {
  const found = configPathOf(cwd);
  return found ? path.basename(found) : CONFIG_FILENAMES[0]!;
}

// Loads and validates the client repo's config (§3). jiti is anchored at
// the config file itself, so its imports (the CLI package, anything
// relative) resolve from the client project no matter where the CLI runs
// from; a TypeScript config needs no build step in the client repo.
export async function loadConfig(cwd: string): Promise<CorpusConfig> {
  const configPath = configPathOf(cwd);
  if (!configPath) {
    throw new CliError(
      `no config found in ${cwd} (looked for ${CONFIG_FILENAMES.join(", ")})`,
    );
  }
  const jiti = createJiti(configPath, { moduleCache: false });
  let loaded: unknown;
  try {
    loaded = await jiti.import(configPath, { default: true });
  } catch (error) {
    // defineCorpus validates as the config module runs, so a bad config
    // surfaces here as a schema error, not only from the parse below.
    const issues = issuesOf(error);
    if (issues) throw invalid(configPath, issues);
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`could not load ${configPath}: ${message}`);
  }
  const parsed = corpusConfigSchema.safeParse(loaded);
  if (!parsed.success) throw invalid(configPath, parsed.error.issues);
  const config = expandSources(parsed.data, cwd);
  markGenerated(config, cwd, configPath);
  return config;
}

type Issue = { path: PropertyKey[]; message: string };

function issuesOf(error: unknown): Issue[] | undefined {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return undefined;
  const wellFormed = issues.every(
    (issue) =>
      Array.isArray((issue as Issue)?.path) &&
      typeof (issue as Issue).message === "string",
  );
  return wellFormed ? (issues as Issue[]) : undefined;
}

function invalid(configPath: string, issues: Issue[]): CliError {
  const list = issues
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "config"}: ${issue.message}`,
    )
    .join("; ");
  return new CliError(`${configPath} is not a valid config: ${list}`);
}

export type TokenSource = "env" | "file";

// The project token (§10): the env var, then the file the workbench
// wrote; where it came from decides whether a rotation rewrites the file.
export function readToken(
  env: NodeJS.ProcessEnv,
  cwd: string,
): { token: string; source: TokenSource } {
  if (env.CORPUS_TOKEN) return { token: env.CORPUS_TOKEN, source: "env" };
  const file = tokenPath(cwd);
  if (existsSync(file)) {
    const token = readFileSync(file, "utf8").trim();
    if (token) return { token, source: "file" };
  }
  throw new CliError(
    `CORPUS_TOKEN is not set and ${CORPUS_DIR}/${TOKEN_FILE} does not exist (the per-project push token)`,
  );
}

export function requireToken(env: NodeJS.ProcessEnv, cwd: string): string {
  return readToken(env, cwd).token;
}

// The code a source's files name a language by: its `languageFiles`
// entry, or the tag itself (#657).
export function fileCodeOf(source: object, language: string): string {
  const files = (source as { languageFiles?: Record<string, string> })
    .languageFiles;
  return files && Object.hasOwn(files, language) ? files[language]! : language;
}

// A source's patterns become concrete sources (#513): an array is one
// source per pattern, and a `{ns}` pattern is one source per namespace
// found in the source language's files, the namespace kept so the ids
// it contributes are `ns:key` and a pull can strip it again.
export function expandSources(input: CorpusInput, cwd: string): CorpusConfig {
  const sources: Source[] = input.sources.flatMap((source, index): Source[] => {
    if (source.adapter === "exec") return [source];
    const patterns = Array.isArray(source.path) ? source.path : [source.path];
    // The patterns of one source are one catalogue the app merges
    // (#661): an id in two of them with the same text is one string.
    // Set here and nowhere else: a `group` written in the config names
    // nothing.
    const group = { group: patterns.length > 1 ? index : undefined };
    return patterns.flatMap((pattern): Source[] => {
      if (!pattern.includes("{ns}"))
        return [{ ...source, path: pattern, ...group }];
      // An Android pattern names a `res` directory, whose source is its
      // `values/strings.xml` (#989).
      const names = namespacesOf(
        cwd,
        source.adapter === "android"
          ? `${pattern.replace(/\/+$/, "")}/values/strings.xml`
          : pattern,
        fileCodeOf(source, input.sourceLanguage),
      );
      if (names.length === 0) {
        throw new CliError(
          `${pattern} matches no file for ${input.sourceLanguage}: nothing fills {ns}`,
        );
      }
      return names.map((ns) => ({
        ...source,
        path: pattern.replaceAll("{ns}", ns),
        namespace: ns,
        pattern,
        ...group,
      }));
    });
  });
  // The same file through two patterns is one file, said once.
  const seen = new Map<string, string>();
  for (const source of sources) {
    if (source.adapter === "exec") continue;
    const file = source.path
      .replaceAll("{lang}", fileCodeOf(source, input.sourceLanguage))
      .replace(/\/+$/, "");
    const first = seen.get(file);
    if (first !== undefined) {
      throw new CliError(
        first === source.path
          ? `${file} is named twice by ${source.path}`
          : `${file} is named twice, by ${first} and ${source.path}`,
      );
    }
    seen.set(file, source.path);
  }
  const misspelled = arbUnderscoreCodes(sources, input.languages, cwd);
  if (misspelled) throw new CliError(misspelled);
  return {
    ...input,
    sources: sources.map((source) =>
      source.adapter === "android"
        ? androidFallbacks(source, input.languages, input.sourceLanguage, cwd)
        : source,
    ),
  };
}

// Android resolves a device's `ta-IN` through `values-ta-rIN`, then
// `values-ta` (#1007): a config language with a region is a module's
// `values-ta` where the module has that and not its own, so one language
// reads every module's spelling of it and a pull writes where each
// module keeps it. Not where the config lists the language or another
// variant that would read it too, which would share the file, nor where
// the region changes the script, which Android matches (`zh-TW` is not
// `values-zh`).
// Set here and nowhere else, as `group` is.
function androidFallbacks<S extends Source>(
  source: S,
  languages: readonly string[],
  sourceLanguage: string,
  cwd: string,
): S {
  const res = path.join(cwd, (source as { path: string }).path);
  // The languages that would take each plain directory: the language
  // itself, the source language's (an English device reads `values-en`
  // before `values`), and the variants that can fall back to it.
  const takers = new Map<string, number>();
  const bases = new Map<string, string>();
  for (const language of languages) {
    const base =
      language === sourceLanguage || /^[^-_]+$/.test(language)
        ? language.split(/[-_]/)[0]!
        : sameScriptBase(language);
    if (!base) continue;
    if (base !== language && language !== sourceLanguage)
      bases.set(language, base);
    const dir = androidDirOf(base);
    takers.set(dir, (takers.get(dir) ?? 0) + 1);
  }
  const dirs: Record<string, string> = {};
  for (const [language, base] of bases) {
    if (takers.get(androidDirOf(base)) !== 1) continue;
    if (
      !existsSync(path.join(res, androidDirOf(language), "strings.xml")) &&
      existsSync(path.join(res, androidDirOf(base), "strings.xml"))
    )
      dirs[language] = androidDirOf(base);
  }
  return {
    ...source,
    languageDirs: Object.keys(dirs).length > 0 ? dirs : undefined,
  };
}

// A language-region tag's language, where the two are written in one
// script.
function sameScriptBase(language: string): string | undefined {
  try {
    const locale = new Intl.Locale(language.replace(/_/g, "-"));
    if (
      !locale.region ||
      locale.script ||
      locale.toString().split("-").length !== 2
    )
      return undefined;
    // Without likely-subtags data neither has a script, and nothing
    // tells zh-TW from zh.
    const script = locale.maximize().script;
    return script !== undefined &&
      script === new Intl.Locale(locale.language).maximize().script
      ? language.split(/[-_]/)[0]
      : undefined;
  } catch {
    return undefined;
  }
}

// A config code a Flutter project spells with an underscore (#627).
function arbUnderscoreCodes(
  sources: Source[],
  languages: string[],
  cwd: string,
): string | undefined {
  for (const source of sources) {
    if (
      source.adapter !== "messages" ||
      !source.path.toLowerCase().endsWith(".arb")
    )
      continue;
    const wrong = languages.filter((code) => {
      if (!code.includes("-") || fileCodeOf(source, code) !== code)
        return false;
      const underscore = code.replaceAll("-", "_");
      return (
        !existsSync(path.join(cwd, source.path.replaceAll("{lang}", code))) &&
        existsSync(path.join(cwd, source.path.replaceAll("{lang}", underscore)))
      );
    });
    if (wrong.length === 0) continue;
    const pairs = wrong
      .map((code) => `${code} as ${code.replaceAll("-", "_")}`)
      .join(" and ");
    const example = source.path.replaceAll(
      "{lang}",
      wrong[0]!.replaceAll("-", "_"),
    );
    return `${source.path} names its files with underscores: write ${pairs} in the config's languages, as gen-l10n does, so pull writes into ${example} rather than beside it`;
  }
  return undefined;
}

// The files a pattern names: `{lang}` is one segment holding a language
// tag (or the one given), `{ns}` one or more segments, and the literal
// parts around them anchor both, so `src/{ns}/i18n/{lang}.json` reaches
// `src/Card/Header/i18n/en.json` and never `src/Button/i18n/nested/en.json`.
export function matchPattern(
  cwd: string,
  pattern: string,
  language?: string,
): { file: string; ns?: string; lang: string }[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const langRe = language
    ? escape(language)
    : "[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*";
  // A placeholder written twice is the same value both times (#856).
  const seen = new Set<string>();
  const source = pattern
    .split(/(\{ns\}|\{lang\})/)
    .map((part) => {
      if (part !== "{ns}" && part !== "{lang}") return escape(part);
      const name = part.slice(1, -1);
      if (seen.has(name)) return `\\k<${name}>`;
      seen.add(name);
      return name === "ns" ? "(?<ns>.+)" : `(?<lang>${langRe})`;
    })
    .join("");
  const re = new RegExp(`^${source}$`);
  const root = pattern.slice(
    0,
    Math.min(
      ...["{ns}", "{lang}"].map((t) =>
        pattern.includes(t) ? pattern.indexOf(t) : pattern.length,
      ),
    ),
  );
  const dir = root.includes("/") ? root.slice(0, root.lastIndexOf("/")) : ".";
  const out: { file: string; ns?: string; lang: string }[] = [];
  const walk = (rel: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(cwd, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = rel === "." ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else {
        const m = re.exec(file);
        if (!m) continue;
        const ns = m.groups!.ns;
        const lang = m.groups!.lang!;
        out.push(ns === undefined ? { file, lang } : { file, ns, lang });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// The namespaces a `{ns}` pattern captures for a language, as written,
// slashes and all, in name order.
export function namespacesOf(
  cwd: string,
  pattern: string,
  language: string,
): string[] {
  if (!pattern.includes("{ns}")) return [];
  return [
    ...new Set(
      matchPattern(cwd, pattern, language).flatMap((m) => (m.ns ? [m.ns] : [])),
    ),
  ].sort();
}

type FileSource = Exclude<Source, { adapter: "exec" }>;

// The file a source keeps a language in: its pattern with {lang}
// filled, or, for Android, the `values` directory of the language.
export function fileOf(
  source: FileSource,
  language: string,
  sourceLanguage: string,
): string {
  if (
    (source.adapter === "xliff" ||
      source.adapter === "gettext" ||
      source.adapter === "qt-ts" ||
      (source.adapter === "messages" && source.keyIsText)) &&
    source.sourcePath &&
    language === sourceLanguage
  )
    return source.sourcePath;
  // A String Catalog holds every language in its one file (#727).
  if (source.adapter === "xcstrings") return source.path;
  if (source.adapter !== "android")
    return source.path.replaceAll("{lang}", fileCodeOf(source, language));
  const dir =
    language === sourceLanguage
      ? "values"
      : (source.languageDirs?.[language] ?? androidDirOf(language));
  return path.posix.join(source.path, dir, "strings.xml");
}

// Why a source's file is an extractor's output, its text the code's
// (#1000): the config says so, or the file does, as the config loads.
// Proposals into it are refused, and a messages file's top-level
// `_comment` is the extractor's note, not a string.
const GENERATED = new WeakMap<object, string>();

// A copy of a source keeps what was detected of it.
export function withGenerated<T extends object>(copy: T, from: object): T {
  const reason = GENERATED.get(from);
  if (reason) GENERATED.set(copy, reason);
  return copy;
}

export function generatedBy(source: Source): string | undefined {
  if (source.adapter === "exec") return undefined;
  return source.generated ? "as the config says" : GENERATED.get(source);
}

// Angular's computed message ids: a decimal digest, or the legacy SHA-1.
const COMPUTED_ID = /^(?:\d{8,}|[0-9a-f]{40})$/;
// The adapters whose file takes proposals; the others' keys are the
// code's already.
const PROPOSABLE = new Set([
  "messages",
  "table",
  "android",
  "fluent",
  "xliff",
  "yaml",
  "strings",
]);

function markGenerated(
  config: CorpusConfig,
  cwd: string,
  configPath: string,
): void {
  const sources = config.sources.filter(
    (s): s is FileSource => s.adapter !== "exec" && PROPOSABLE.has(s.adapter),
  );
  const files = sources.map((s) =>
    fileOf(s, config.sourceLanguage, config.sourceLanguage),
  );
  // A file git ignores is a build's output, unless the config is ignored
  // too, as a project inside another repository's ignored tree is.
  const configRel = path.relative(cwd, configPath);
  // Asked only where a source's being generated is still unknown.
  const asked = sources.some((source) => source.generated !== true)
    ? gitIgnored(cwd, [configRel, ...files])
    : [];
  if (typeof asked === "string") UNCHECKED.set(config, asked);
  const ignored = new Set(typeof asked === "string" ? [] : asked);
  sources.forEach((source, index) => {
    const file = files[index]!;
    const reason =
      !ignored.has(configRel) && ignored.has(file)
        ? "since git ignores it"
        : echoesKeys(source, path.join(cwd, file))
          ? "since every value is its key"
          : angularExtract(source, path.join(cwd, file))
            ? "since Angular's extract-i18n wrote it"
            : undefined;
    if (reason) GENERATED.set(source, reason);
  });
}

// Why git was not asked which source files it ignores, for a note.
const UNCHECKED = new WeakMap<object, string>();

export function ignoreUnchecked(config: CorpusConfig): string | undefined {
  return UNCHECKED.get(config);
}

// The paths git ignores, or why git cannot be asked. A path outside the
// work tree is not asked, and one git still refuses to judge, behind a
// symlink say, is asked alone: one refusal fails the whole call (#1176).
function gitIgnored(cwd: string, paths: string[]): string[] | string {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (top.error) return "no git";
  // git's own reason where it refuses the repository, as for a checkout
  // another user owns, which safe.directory answers.
  if (top.status !== 0)
    return /not a git repository/.test(top.stderr)
      ? "not a git repository"
      : (top.stderr.split("\n")[0] ?? "").replace(/^fatal: /, "") ||
          `git exited ${top.status}`;
  const root = top.stdout.replace(/\n$/, "");
  const real = (file: string): string => {
    try {
      return realpathSync(file);
    } catch {
      const up = path.dirname(file);
      return up === file ? file : path.join(real(up), path.basename(file));
    }
  };
  const judged = paths.filter((file) => {
    const rel = path.relative(root, real(path.resolve(cwd, file)));
    return (
      rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    );
  });
  // NUL-separated both ways, so a path outside ASCII comes back as
  // written rather than quoted; exit 1 is none ignored.
  const ask = (input: string[]) => {
    const check = spawnSync("git", ["check-ignore", "-z", "--stdin"], {
      cwd,
      encoding: "utf8",
      input: input.join("\0"),
    });
    return check.status === 0 || check.status === 1
      ? check.stdout.split("\0").filter(Boolean)
      : undefined;
  };
  return ask(judged) ?? judged.flatMap((file) => ask([file]) ?? []);
}

// Zulip's makemessages output: a flat file whose every value is its
// key, sentences among them.
function echoesKeys(source: FileSource, file: string): boolean {
  if (source.adapter !== "messages" || !file.endsWith(".json")) return false;
  try {
    const data: unknown = JSON.parse(stripBom(readFileSync(file, "utf8")));
    if (data === null || typeof data !== "object" || Array.isArray(data))
      return false;
    const entries = Object.entries(data);
    return (
      // One echoing entry is a coincidence, not a catalogue's shape.
      entries.length >= 3 &&
      entries.every(([key, value]) => value === key) &&
      entries.some(([key]) => keyIsSentence(key))
    );
  } catch {
    return false;
  }
}

// Angular's extract-i18n output: its `<file original="ng2.template">`
// (XLIFF 1.2) or `"ng.template"` (2.0), or ids most of which are the
// ones it computes, custom `@@` ids (paperless-ngx's 44 of 1,456) and
// a library's (ng-bootstrap's `ngb.*`) beside them.
function angularExtract(source: FileSource, file: string): boolean {
  if (source.adapter !== "xliff") return false;
  try {
    const text = readFileSync(file, "utf8");
    if (/<file\b[^>]*\boriginal="ng2?\.template"/.test(text)) return true;
    const ids = [
      ...text.matchAll(/<(?:trans-unit|unit)\b[^>]*?\bid="([^"]*)"/g),
    ].map((m) => m[1]!);
    return (
      ids.length > 0 &&
      ids.filter((id) => COMPUTED_ID.test(id)).length * 2 > ids.length
    );
  } catch {
    return false;
  }
}
