import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  androidDirOf,
  gettextToEntries,
  androidLanguageOf,
  isChromeMessages,
  keyIsSentence,
  parseXcstrings,
  pluralBranches,
  yamlStrings,
  stripBom,
  xcstringsLanguages,
} from "@corpus/adapters";
import {
  corpusConfigSchema,
  LANGUAGE_RE,
  CONFIG_LIBRARIES,
  localeOf,
  parseIcu,
  posixTag,
  tagMode,
  richTextFor,
  type Library,
} from "@corpus/contract";
import { headOf, isQtLinguist, unreadableFile } from "./catalogue-format";
import { option } from "./args";
import { printable } from "./printable";
import {
  configKey,
  fileOf,
  isArb,
  readEntries,
  sourceLibrary,
  sourcePluralIds,
  type FileSource,
} from "./build";
import { DEFAULT_INCLUDE, EXTENSIONS, READS, SKIP_DIRS } from "./check";
import type { RunContext } from "./cli";
import {
  CliError,
  CONFIG_FILENAMES,
  matchPattern,
  namespacesOf,
} from "./config";
import { ignoreCorpusDir } from "./corpus-dir";

export const INIT_USAGE =
  "corpus init --project <slug> --source <lang> --messages <path with {lang}, a .xcstrings or an Android res directory> [--languages <a,b>] [--server <url>] [--type <name>] [--library <icu|formatjs|gen_l10n|fmt|i18next|vue|printf|chrome|counterpart|easy_localization|rails|qt>]";

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
  // An Android res directory, or its `values-{lang}/strings.xml`, is
  // one source whose languages its `values-*` directories name (#993).
  const res = catalog ? undefined : androidResOf(ctx.cwd, messages);
  if (!catalog && res === undefined && !messages.includes("{lang}")) {
    throw new CliError(
      `--messages must contain {lang}, such as src/i18n/{lang}.json`,
    );
  }
  const { adapter, sourcePath, keyIsText, entries } =
    res !== undefined
      ? {
          adapter: "android" as const,
          sourcePath: undefined,
          keyIsText: undefined,
          entries: undefined,
        }
      : formatOf(ctx, messages, sourceLanguage, catalog !== undefined);
  // An XLIFF unit's text is ICU, as a Fluent message is read as ICU,
  // and a flag that cannot apply is refused rather than dropped.
  if (
    (adapter === "xliff" || adapter === "fluent" || adapter === "android") &&
    (args.includes("--library") || args.includes("--syntax"))
  )
    throw new CliError(
      `--library does not apply to ${adapter === "xliff" ? "an xliff source: its text is ICU" : adapter === "fluent" ? "a fluent source: its messages are read as ICU" : "an android source: its strings are Android's"}\nusage: ${INIT_USAGE}`,
    );
  const files =
    res !== undefined
      ? androidLanguages(ctx, res, sourceLanguage)
      : catalog || messages.includes("{ns}")
        ? { languages: [], languageFiles: {}, skipped: [] }
        : catalogueLanguages(ctx.cwd, messages, sourceLanguage);
  // Beside a JSON catalogue a file that names no language is a glossary
  // or a fixture, not a catalogue left out, unless its name carries a
  // POSIX modifier (`de@euro`), which only a language's does.
  const unnamed =
    adapter === "messages"
      ? files.skipped.filter(({ file }) => path.basename(file).includes("@"))
      : files.skipped;
  // A code that is a prefix and a language, `activerecord.af` beside
  // `{lang}.yml`, is another catalogue's file (#1020): one line for the
  // family, as its own source, not a mapping a file at a time.
  const families = new Map<string, number>();
  const loose: typeof unnamed = [];
  for (const entry of unnamed) {
    const family = /^(.+)\.([^.]+)$/.exec(entry.code);
    // `pt.BR` is a language and a region with a dot, not a family.
    const dotted = /^[A-Za-z]{2,3}\.(?:[A-Z]{2}|[0-9]{3})$/.test(entry.code);
    if (
      family &&
      !dotted &&
      (LANGUAGE_RE.test(family[2]!) || posixTag(family[2]!))
    ) {
      const pattern = messages.replaceAll("{lang}", `${family[1]}.{lang}`);
      families.set(pattern, (families.get(pattern) ?? 0) + 1);
    } else loose.push(entry);
  }
  if (families.size > 0) {
    const patterns = [...families.keys()].sort();
    const count = [...families.values()].reduce((a, b) => a + b, 0);
    const named = `${patterns.slice(0, 5).join(", ")}${patterns.length > 5 ? ", …" : ""}`;
    // A source that takes a list holds them as one catalogue, as Rails
    // loads a yaml family (#1024); any other takes one each.
    ctx.err(
      LISTS_PATTERNS.has(adapter)
        ? `corpus: ${patterns.length} other catalogue(s) beside ${messages}, ${count} file(s) (${named}): where the app loads them into one catalogue${adapter === "yaml" ? ", as Rails does" : ""}, list them in the source's path in the order it loads them, path: ${JSON.stringify([messages, ...patterns]).replace(/","/g, '", "')}; otherwise each is its own source`
        : `corpus: ${patterns.length} other catalogue(s) beside ${messages}, ${count} file(s) (${named}): each is its own source, as { adapter: ${JSON.stringify(adapter)}, type: ${JSON.stringify(type)}, path: ${JSON.stringify(patterns[0])} }`,
    );
  }
  for (const { file, code } of loose.slice(0, 5))
    ctx.err(
      `corpus: ${file} names no language tag; left out: name its language, as languages: ["<tag>"] with languageFiles: { "<tag>": ${JSON.stringify(code)} } on the source`,
    );
  if (loose.length > 5)
    ctx.err(
      `corpus: and ${loose.length - 5} more file(s) that name no language tag`,
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
  // Only the messages adapter's library is detected, and gettext's fmt
  // fields (#1002); every other format has its default, which only the
  // flag changes, and xliff's is fixed.
  const flagged = args.includes("--library") || args.includes("--syntax");
  const detected =
    adapter === "gettext" && !flagged
      ? gettextLibrary(
          path.join(
            ctx.cwd,
            sourcePath ?? messages.replaceAll("{lang}", sourceLanguage),
          ),
        )
      : adapter === "xliff" || (adapter !== "messages" && !flagged)
        ? {}
        : await libraryFor(
            args,
            ctx.cwd,
            messages,
            sourceLanguage,
            type,
            ctx,
            keyIsText ? sourcePath : undefined,
            entries,
          );
  const library = detected.library;
  const components = checkIncludeFor(ctx.cwd, res ?? messages);
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
    path: res ?? messages,
    ...(sourcePath && { sourcePath }),
    ...(keyIsText && { keyIsText }),
    ...(entries && { entries }),
    ...("placeholders" in detected &&
      detected.placeholders && { placeholders: detected.placeholders }),
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
  const htmlIds = await htmlOnlyTags(ctx.cwd, source, sourceLanguage);
  const htmlTags = htmlIds.length;
  // The keys, a few, so the line says where.
  const htmlKeys = `${htmlIds.slice(0, 3).map(printable).join(", ")}${htmlTags > 3 ? ", …" : ""}`;
  const readAsHtml =
    htmlTags > 0 &&
    adapter === "yaml" &&
    sourceLibrary(source as FileSource) === "rails";
  const variants = sourceVariantsOf(languages, sourceLanguage);
  const config: InitConfig = {
    project,
    server,
    sourceLanguage,
    languages,
    ...(variants.length > 0 && { sourceVariants: variants }),
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
    const why = library.detected && (library.why ?? DETECTED_BY[library.value]);
    ctx.out(
      `library: ${library.value}${why ? `, from ${why} in ${library.detected}` : ""}`,
    );
  }
  if (detected.note) ctx.out(detected.note);
  if (source.placeholders)
    ctx.out(
      `placeholders: ${source.placeholders.join(", ")}, ${source.placeholders.includes("i18next") ? "{{name}}" : "%s"} in the texts beside ${library?.value}'s own`,
    );
  if (variants.length > 0)
    ctx.out(
      variants.length === 1
        ? `sourceVariants: ${variants[0]} (a variant of ${sourceLanguage}: a row it leaves as the source's text seeds as translated, and a row it lacks is not listed as work, since the app falls back to ${sourceLanguage}; remove a variant whose rows are work)`
        : `sourceVariants: ${variants.join(", ")} (variants of ${sourceLanguage}: a row a variant leaves as the source's text seeds as translated, and a row it lacks is not listed as work, since the app falls back to ${sourceLanguage}; remove a variant whose rows are work)`,
    );
  if (adapter === "yaml" && !library)
    ctx.out("library: rails (the yaml source's default)");
  if (readAsHtml)
    ctx.out(
      `richText: ${type} is read as HTML: ${htmlTags} source string(s) hold tags only HTML takes as text, an unclosed tag or a lone <br> (${htmlKeys})`,
    );
  else if (htmlTags > 0)
    ctx.out(
      `corpus: ${htmlTags} source string(s) hold tags only HTML takes as text, an unclosed tag or a lone <br> (${htmlKeys}), and are refused as they are: if the app renders ${type} as HTML, add richText: { ${configKey(type)}: "html" } to ${filename}`,
    );
  if (include) {
    ctx.out(
      `check.include: ${include.join(", ")} (the directories holding components, which corpus check scans)`,
    );
  } else if (!components.found) {
    // A UI that is never JSX, TSX, Vue or Svelte gives check nothing to read,
    // whatever it is pointed at (#1016).
    ctx.out(
      NO_COMPONENTS[adapter]
        ? `corpus check reads ${READS} components, which ${NO_COMPONENTS[adapter]} has none of: leave corpus check out of CI`
        : `check.include: init found no ${EXTENSIONS.join(", ").replace(/, ([^,]*)$/, " or $1")} components where it looks; set check.include in ${filename} to where they are, or, if the UI is written in something else (C, GTK, Angular, templates), corpus check does not apply: leave it out of CI`,
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

// The sources whose path may list several patterns (#661, #1024).
const LISTS_PATTERNS: ReadonlySet<InitSource["adapter"]> = new Set([
  "messages",
  "fluent",
  "android",
  "yaml",
]);

// The formats whose interface is never JSX, TSX, Vue or Svelte, by what it is;
// a .po catalogue may be a Lingui or Vue app's, an XLIFF one not always
// Angular's.
const NO_COMPONENTS: Partial<Record<InitSource["adapter"], string>> = {
  "qt-ts": "a Qt interface",
  android: "an Android app",
  xcstrings: "an Apple app",
};

type InitSource = {
  adapter:
    | "messages"
    | "xliff"
    | "gettext"
    | "xcstrings"
    | "qt-ts"
    | "yaml"
    | "fluent"
    | "android"
    | "strings";
  type: string;
  path: string;
  sourcePath?: string;
  keyIsText?: boolean;
  entries?: { text: string; note?: string };
  placeholders?: Library[];
  library?: Library;
  languageFiles?: Record<string, string>;
};

type InitConfig = {
  project: string;
  server: string;
  sourceLanguage: string;
  languages: string[];
  sourceVariants?: string[];
  sources: [InitSource];
  richText?: Record<string, "html">;
  check?: { include: string[] };
};

// The source file's strings refused as the library reads their tags and
// taken as text where the type is read as HTML (#952), a Rails `_html`
// key, read as HTML already, never among them (#988); none where the
// file will not read, which build then says.
async function htmlOnlyTags(
  cwd: string,
  source: InitSource,
  sourceLanguage: string,
): Promise<string[]> {
  const declared = source as FileSource;
  // A `{ns}` pattern's source files, each, its ids named as build names
  // them (#993).
  const files = source.path.includes("{ns}")
    ? matchPattern(cwd, source.path, sourceLanguage)
    : [
        {
          file: fileOf(declared, sourceLanguage, sourceLanguage),
          ns: undefined,
        },
      ];
  const entries = [];
  for (const { file, ns } of files) {
    try {
      const read = await readEntries(
        createJiti(import.meta.url),
        cwd,
        file,
        declared,
        true,
        sourceLanguage,
      );
      entries.push(
        ...read.map((e) => (ns ? { ...e, id: `${ns}:${e.id}` } : e)),
      );
    } catch {
      continue;
    }
  }
  const ids: string[] = [];
  for (const entry of entries) {
    const library = entry.library ?? sourceLibrary(declared);
    const reading = richTextFor(entry.type, entry.id, library, undefined);
    if (
      !parseIcu(entry.source, library, { html: tagMode(library, reading) })
        .ok &&
      parseIcu(entry.source, library, { html: "markup" }).ok
    )
      ids.push(entry.id);
  }
  return ids;
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
): {
  adapter: InitSource["adapter"];
  sourcePath?: string;
  keyIsText?: true;
  entries?: { text: string; note?: string };
} {
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
    if (!sourcePath && missing) {
      gitIgnored(ctx, relative);
      if (bare !== undefined) gitIgnored(ctx, bare);
    }
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
    if (templates.length === 0 && missing) {
      gitIgnored(ctx, relative);
      // A msgmerged target holds every msgid, with its references: its
      // msgids are the catalogue's, read as the source's, and it is
      // still written as a target (#996).
      const target = sourceFromTargets(ctx.cwd, messages);
      if (target) {
        ctx.err(
          `corpus: no template: sourcePath is ${target.file}, whose msgids are the catalogue's; point it at a .pot when one is committed`,
        );
        if (target.lacking > 0)
          ctx.err(
            `corpus: ${target.file} lacks ${target.lacking} msgid(s) another current catalogue holds; those are not read`,
          );
        if (target.older > 0)
          ctx.err(
            `corpus: ${target.older} msgid(s) only older catalogues hold, likely removed since, are not read`,
          );
        return { adapter: "gettext", sourcePath: target.file };
      }
      ctx.err(
        `corpus: no .pot beside the catalogues and no ${relative}; set the gettext source's sourcePath to the template xgettext writes`,
      );
    }
    return {
      adapter: "gettext",
      ...(templates.length === 1 && { sourcePath: templates[0] }),
    };
  }
  // Apple's `Localizable.strings` (#1037), Xcode's `{lang}.lproj`.
  if (/\.strings$/i.test(messages)) {
    refuseNamespace(messages, "strings");
    if (missing) {
      gitIgnored(ctx, relative);
      throw new CliError(
        `--messages ${messages}: no ${relative} to read the source language's strings from`,
      );
    }
    return { adapter: "strings" };
  }
  // Rails I18n's YAML (#754): one file per language, rooted at its code.
  // Any other YAML (Symfony's, Hugo's) is refused here, by what it holds,
  // rather than written into a config that cannot build.
  if (/\.ya?ml$/i.test(messages)) {
    refuseNamespace(messages, "yaml");
    if (missing) gitIgnored(ctx, relative);
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
    if (missing && !sourcePath) {
      gitIgnored(ctx, relative);
      ctx.err(
        `corpus: no ${relative}; set the qt-ts source's sourcePath to the template lupdate writes`,
      );
    }
    return { adapter: "qt-ts", ...(sourcePath && { sourcePath }) };
  }
  // A generated source file git ignores, beside targets that each hold
  // its keys, the English text (#999): Zulip's makemessages output.
  const keyed =
    missing && /\.json$/i.test(messages) && !messages.includes("{ns}")
      ? textKeyedTarget(ctx.cwd, messages, sourceLanguage)
      : undefined;
  if (keyed && "other" in keyed)
    ctx.err(
      `corpus: no ${relative}; ${keyed.other} names no language: if it is the source language's file, map it with languageFiles, or, if a committed target's keys are the source text, set sourcePath and keyIsText: true`,
    );
  if (keyed && "plural" in keyed)
    ctx.err(
      `corpus: no ${relative}; the targets' keys carry plural suffixes (_one, _other), whose English no key holds, so none is read as the source`,
    );
  if (keyed && "aside" in keyed)
    ctx.err(
      `corpus: no ${relative}; ${keyed.aside} may be the source language's file under another code: pass --source ${keyed.tag} if so, or, where its keys are the text, set sourcePath to a committed target with keyIsText: true`,
    );
  if (keyed && "file" in keyed) {
    ctx.err(
      `corpus: no ${relative}, and the ${keyed.files} target files hold one key set of sentences: sourcePath is ${keyed.file}, with keyIsText: true reading its keys as the text`,
    );
    return { adapter: "messages", sourcePath: keyed.file, keyIsText: true };
  }
  // Every format's build reads the source language's file (#856).
  if (
    messages.includes("{ns}")
      ? matchPattern(ctx.cwd, messages, sourceLanguage).length === 0
      : missing
  ) {
    ctx.err(
      `corpus: no ${relative}: build reads the source language's strings from it`,
    );
    if (missing && !messages.includes("{ns}")) gitIgnored(ctx, relative);
  }
  // Fluent's `.ftl` reads `{ns}` as messages does (#993).
  if (/\.ftl$/i.test(messages)) return { adapter: "fluent" };
  const unreadable = unreadableFile(sourceFile);
  if (unreadable) throw new CliError(`--messages ${messages}: ${unreadable}`);
  const entries = entryFields(sourceFile);
  if (entries) {
    ctx.err(
      `corpus: each value is an entry object: entries reads its text from ${entries.text}${entries.note ? ` and its note from ${entries.note}` : ""}`,
    );
    return { adapter: "messages", entries };
  }
  return { adapter: "messages" };
}

// FormatJS's extract formats and Signal's write each string as an
// object, its text in one field beside its metadata (#1001); the
// smartling format adds a config object of that name. Chrome's shape is
// a library of its own.
const ENTRY_FIELDS = [
  "messageformat",
  "defaultMessage",
  "message",
  "string",
  "translation",
] as const;
const ENTRY_METADATA = new Set([
  "description",
  "developer_comment",
  "notes",
  "context",
  "character_limit",
  "limit",
  "ignoreUnused",
  "id",
  "meaning",
]);

// The note field beside the text: the one of ENTRY_NOTES the most
// entries hold as a string.
const ENTRY_NOTES = ["description", "developer_comment", "notes"] as const;

function entryFields(
  file: string,
): { text: string; note?: string } | undefined {
  const text = entryField(file);
  if (!text) return undefined;
  const data = JSON.parse(stripBom(readFileSync(file, "utf8"))) as Record<
    string,
    Record<string, unknown>
  >;
  const values = Object.values(data).filter(
    (v) => v !== null && typeof v === "object",
  );
  const counts = ENTRY_NOTES.map(
    (note) =>
      [note, values.filter((v) => typeof v[note] === "string").length] as const,
  ).filter(([, n]) => n > 0);
  const note = counts.sort((a, b) => b[1] - a[1])[0]?.[0];
  return { text, ...(note && { note }) };
}

function entryField(file: string): string | undefined {
  if (!file.endsWith(".json") || chromeShaped(file)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return undefined;
  const entries = Object.entries(data).filter(([key]) => key !== "smartling");
  if (entries.length === 0) return undefined;
  // The text field on every entry, and on nine in ten nothing else but
  // metadata: Signal's one `descrption` decides nothing, and a catalogue
  // whose sections merely share a key is no such file.
  return ENTRY_FIELDS.find((field) => {
    let plain = 0;
    for (const [, value] of entries) {
      if (value === null || typeof value !== "object") return false;
      const record = value as Record<string, unknown>;
      if (typeof record[field] !== "string") return false;
      if (
        Object.keys(record).every(
          (key) => key === field || ENTRY_METADATA.has(key),
        )
      )
        plain += 1;
    }
    return plain >= entries.length * 0.9;
  });
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

// The targets in the source's own language and script, `en_GB` beside
// `en`, whose rows left as the source's text are what the app ships
// (#1014); `zh-Hant` beside `zh-Hans` or `sr-Latn` beside `sr` is a
// translation of its own.
function sourceVariantsOf(
  languages: readonly string[],
  sourceLanguage: string,
): string[] {
  const base = (tag: string) => tag.split(/[-_]/)[0]!.toLowerCase();
  const script = (tag: string) => {
    try {
      return new Intl.Locale(tag.replace(/_/g, "-")).maximize().script;
    } catch {
      return undefined;
    }
  };
  const own = script(sourceLanguage);
  return languages.filter(
    (tag) =>
      tag !== sourceLanguage &&
      // A pseudo-locale, `en-XA`, is generated, no variant.
      !/[-_]X[A-C]$/i.test(tag) &&
      base(tag) === base(sourceLanguage) &&
      own !== undefined &&
      script(tag) === own,
  );
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
${config.sourceVariants ? `  sourceVariants: [${config.sourceVariants.map(q).join(", ")}],\n` : ""}  sources: [
    { adapter: ${q(source.adapter)}, type: ${q(source.type)}, path: ${q(source.path)}${source.sourcePath ? `, sourcePath: ${q(source.sourcePath)}` : ""}${source.keyIsText ? ", keyIsText: true" : ""}${source.entries ? `, entries: { text: ${q(source.entries.text)}${source.entries.note ? `, note: ${q(source.entries.note)}` : ""} }` : ""}${library}${source.placeholders ? `, placeholders: [${source.placeholders.map(q).join(", ")}]` : ""}${
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
    // A Handlebars app keeps its markup in `templates`, its partials
    // below it, as Zulip's `web/templates` does (#1027).
    const root =
      entry.name === "components"
        ? holdsCheckedFile(path.join(cwd, child))
        : entry.name === "templates" &&
          holdsCheckedFile(path.join(cwd, child), HANDLEBARS);
    if (root) out.push(child);
    else out.push(...componentDirs(cwd, child, depth + 1));
  }
  return out;
}

// The FormatJS runtime a package.json names, nearest the catalogue
// first, then the repository's: react-intl, next-intl and its use-intl,
// svelte-i18n, ember-intl, intl-messageformat, @formatjs/intl, its
// parser or its CLI. FormatJS's `Intl` polyfills
// (`@formatjs/intl-pluralrules`) read no messages, and i18next projects
// load them too; Lingui's parser quotes otherwise (`l'{name}` keeps its
// apostrophe), so it stays icu.
const FORMATJS_RE =
  /^(?:react-intl|next-intl|use-intl|svelte-i18n|ember-intl|intl-messageformat|@formatjs\/(?:intl|icu-messageformat-parser|cli))$/;

function formatjsRuntime(
  cwd: string,
  messages: string,
): { detected: string; why: string } | undefined {
  const pkg = packageOf(cwd, messages);
  for (const dir of [...(pkg ? [pkg] : []), "."]) {
    const file = path.join(cwd, dir, "package.json");
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (manifest === null || typeof manifest !== "object") continue;
    const names = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ].flatMap((field) =>
      Object.keys(
        ((manifest as Record<string, unknown>)[field] as object | undefined) ??
          {},
      ),
    );
    const found = names.find((name) => FORMATJS_RE.test(name));
    if (found)
      return { detected: path.posix.join(dir, "package.json"), why: found };
  }
  return undefined;
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
const HANDLEBARS = [".hbs", ".handlebars"] as const;

function holdsCheckedFile(
  dir: string,
  extensions: readonly string[] = EXTENSIONS,
): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      if (holdsCheckedFile(path.join(dir, entry.name), extensions)) return true;
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
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

// A gettext catalogue whose placeholders are libfmt or str.format
// fields, `{count:L}`, and no printf verb, is fmt's (#1002): printf
// would read its braces as text, and a wrong field aborts the program.
function gettextLibrary(file: string): {
  library?: { value: Library; detected: string; why: string };
  note?: string;
} {
  let ids: string[];
  try {
    ids = gettextToEntries(readFileSync(file, "utf8"), { type: "x" }).map(
      (e) => e.id,
    );
  } catch {
    return {};
  }
  // A named field: C#'s composite `{0}` and `{0,-10}` are no fmt's.
  // Not `{{user}}`, angular-gettext's and Jinja's.
  const field =
    /(?<!\{)\{[A-Za-z_]\w*(?:[.[][^{}]*)?(?:![rsa])?(?::[^{}]*)?\}(?!\})/;
  const typed =
    /\{\s*\w+\s*,\s*(?:plural|select|selectordinal|number|date|time)\b/;
  // Python's `%(name)s` is printf's too (#1012).
  const key = /%\([^)]+\)[#0 +-]*\d*(?:\.\d+)?[diouxXeEfFgGcrsa]/;
  const fields = ids.filter((id) => field.test(id) && !typed.test(id)).length;
  const verbs = ids.filter((id) => PRINTF_RE.test(id) || key.test(id)).length;
  if (fields < 2 || fields <= verbs) return {};
  return {
    library: {
      value: "fmt",
      detected: path.basename(file),
      why: "libfmt and str.format {name} fields",
    },
    ...(verbs > 0 && {
      note: `${verbs} msgid(s) write printf verbs or %(name)s, which fmt reads as text`,
    }),
  };
}

// Whether the project's l10n.yaml turns on gen-l10n's apostrophe
// escaping (#1038).
function useEscaping(cwd: string): boolean {
  try {
    return /^\s*use-escaping\s*:\s*true\b/m.test(
      readFileSync(path.join(cwd, "l10n.yaml"), "utf8"),
    );
  } catch {
    return false;
  }
}

// Chrome's `{ message, description }`, which FormatJS's crowdin format
// writes too (#1001): FormatJS's where its text writes a typed ICU
// argument (`{count, plural, …}`) and no Chrome `$NAME$` or
// `placeholders`; a bare `{name}` decides nothing, as uBlock's Chrome
// catalogue writes `{{count}}`.
function chromeShaped(file: string): boolean {
  if (!file.endsWith(".json")) return false;
  try {
    const data: unknown = JSON.parse(stripBom(readFileSync(file, "utf8")));
    if (!isChromeMessages(data)) return false;
    const values = Object.values(data);
    const chrome = values.some(
      (v) =>
        v.placeholders !== undefined || /\$[A-Za-z0-9_@]+\$/.test(v.message),
    );
    const icu = values.some((v) =>
      /\{\s*[A-Za-z_][\w.-]*\s*,\s*(?:plural|select|selectordinal|number|date|time)\b/.test(
        v.message,
      ),
    );
    return chrome || !icu;
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
  // A committed target whose keys are the text (#999), read in place of
  // the source language's file.
  textKeyed?: string,
  // Entry objects (#1001): their text field is the text.
  entryObjects?: { text: string; note?: string },
): Promise<{
  library?: { value: Library; detected?: string; why?: string };
  note?: string;
  // A second placeholder syntax the texts write (#1049).
  placeholders?: Library[];
}> {
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
    if (!(CONFIG_LIBRARIES as readonly string[]).includes(given ?? "")) {
      throw new CliError(
        `${flag} takes ${CONFIG_LIBRARIES.join(", ")}\nusage: ${INIT_USAGE}`,
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
  const file =
    textKeyed ?? concretes[0]?.replaceAll("{lang}", sourceLanguage) ?? pattern;
  let texts: string[];
  let ids: string[];
  let keyed = 0;
  try {
    const jiti = createJiti(import.meta.url);
    texts = [];
    ids = [];
    for (const concrete of concretes) {
      const source: FileSource = {
        adapter: "messages",
        type,
        path: concrete,
        ...(textKeyed && { sourcePath: textKeyed, keyIsText: true }),
        ...(entryObjects && { entries: entryObjects }),
      };
      const entries = await readEntries(
        jiti,
        cwd,
        textKeyed ?? concrete.replaceAll("{lang}", sourceLanguage),
        source,
        true,
      );
      // An object's forms are what the file writes: the plural the
      // reader makes of them is no ICU argument of the catalogue's (#984).
      const objects = await sourcePluralIds(jiti, cwd, source, sourceLanguage);
      texts.push(
        ...entries.flatMap((entry) => {
          const forms = objects?.has(entry.id)
            ? pluralBranches(entry.source)
            : undefined;
          return forms ? Object.values(forms) : [entry.source];
        }),
      );
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
  // uBlock fills its own `{{name}}` beside Chrome's `$NAME$` (#1049).
  const layered = (re: RegExp) => texts.filter((t) => re.test(t)).length >= 2;
  if (chrome)
    return {
      library: { value: "chrome", detected: file },
      ...(layered(/\{\{\w+\}\}/) && { placeholders: ["i18next" as const] }),
    };
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
    return {
      library: { value: "i18next", detected: file },
      // i18next-sprintf-postprocessor's `%s` (#1049).
      ...(printf >= 2 && { placeholders: ["printf" as const] }),
    };
  const noted = (note: string) => `${note} in ${file}`;
  // Where the catalogue reads as icu, ICU as FormatJS reads it, its
  // apostrophe quoting (#1010), if its package runs on FormatJS.
  const runtime = formatjsRuntime(cwd, pattern);
  // An .arb catalogue read as ICU is Flutter's gen-l10n's (#1038), whose
  // subset the library reads; another shape counted above names its own.
  const flutter = isArb(file)
    ? {
        library: {
          value: "gen_l10n" as const,
          detected: file,
          why: "the .arb catalogue Flutter's gen-l10n reads",
        },
        ...(useEscaping(cwd) && {
          note: "l10n.yaml sets use-escaping: true, gen-l10n's apostrophe quoting, which Corpus does not read: a brace quoted there reads as a placeholder",
        }),
      }
    : undefined;
  const asIcu = (note?: string) =>
    flutter
      ? { ...flutter, ...(note && !flutter.note && { note }) }
      : runtime
        ? { library: { value: "formatjs" as const, ...runtime } }
        : note
          ? { note }
          : {};
  // Ghost's shape (#589): the sentence is the key and the value is "".
  // A committed target named as the source says its own why (#999).
  if (!textKeyed && keyed > 0 && keyed * 2 >= texts.length) {
    return {
      ...asIcu(),
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
  // An ICU plural or select names the catalogue ICU's, an id ending in
  // `_other` aside (Mastodon's react-intl, #1020).
  if (
    doubles === 0 &&
    singles > 0 &&
    !icu &&
    ids.some((id) => PLURAL_SUFFIX_RE.test(id))
  ) {
    return asIcu(
      noted(
        "i18next keys with { } interpolation: read as icu, which checks the placeholders",
      ),
    );
  }
  // vue-i18n: a quoted literal is enough; a pipe only where nothing else
  // in the catalogue reads as ICU.
  const anyIcu = texts.some((text) => ICU_ANY_ARGUMENT_RE.test(text));
  if (doubles === 0 && !icu && (escapes || (pipes && !anyIcu))) {
    return { library: { value: "vue", detected: file } };
  }
  return asIcu();
}

// The res directory `--messages` names: the directory itself, its
// `values` or `values/strings.xml`, or `<res>/values-{lang}/strings.xml`,
// where `<res>/values/strings.xml` holds the source's strings (#993).
function androidResOf(cwd: string, messages: string): string | undefined {
  const pattern = /^(.+?)\/+values(?:-\{lang\})?(?:\/+strings\.xml)?\/*$/.exec(
    messages,
  );
  const res = (pattern ? pattern[1]! : messages).replace(/\/+$/, "");
  if (!pattern && messages.includes("{lang}")) return undefined;
  return existsSync(path.join(cwd, res, "values", "strings.xml"))
    ? res
    : undefined;
}

// The languages a res directory's `values-*` directories holding a
// strings.xml name, the source first. A directory is kept only where it
// is the one the android source reads and writes for its tag, so a pull
// never writes a second directory for one locale; any other, a
// qualifier that is no language (`values-sw360dp`, `values-car`) or the
// b+ form of a `-r` region, is said and left out.
function androidLanguages(
  ctx: RunContext,
  res: string,
  sourceLanguage: string,
): {
  languages: string[];
  languageFiles: Record<string, string>;
  skipped: { file: string; code: string }[];
} {
  const dirs = readdirSync(path.join(ctx.cwd, res)).filter(
    (name) =>
      name.startsWith("values-") &&
      existsSync(path.join(ctx.cwd, res, name, "strings.xml")),
  );
  const tags = new Set<string>();
  for (const dir of dirs.sort()) {
    const tag = androidLanguageOf(dir);
    // A tag the runtime does not know is kept, and said below, as any
    // catalogue's is.
    if (tag === undefined) {
      ctx.err(
        `corpus: ${res}/${dir} is no language's own values directory; left out`,
      );
      continue;
    }
    if (androidDirOf(tag) !== dir) {
      ctx.err(
        `corpus: ${res}/${dir} names ${tag}, which the android source reads from ${androidDirOf(tag)}; left out`,
      );
      continue;
    }
    tags.add(tag);
  }
  tags.delete(sourceLanguage);
  return {
    languages: [sourceLanguage, ...[...tags].sort()],
    languageFiles: {},
    skipped: [],
  };
}

// Only messages, table, fluent and android read `{ns}` (#854, #989).
function refuseNamespace(messages: string, adapter: string): void {
  if (messages.includes("{ns}"))
    throw new CliError(
      `--messages ${messages}: ${adapter} does not read {ns}: only messages, table, fluent and android do`,
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

// A missing source file git ignores is generated, by a build step the
// repository does not commit the output of (Zulip's `/locale/en`).
function gitIgnored(ctx: RunContext, rel: string): void {
  const check = spawnSync("git", ["check-ignore", "-q", rel], {
    cwd: ctx.cwd,
    stdio: "ignore",
  });
  if (check.status === 0)
    ctx.err(
      `corpus: ${rel} is git-ignored, so it is generated: commit it, or point the source at a file that is committed`,
    );
}

// The target to read as the source where every JSON target holds one
// key set, most of it sentences (#999): the one with the most text, so
// what it seeds is the most. None where any file the pattern fills is
// no language's or does not read as flat strings, or where a file of
// the source's own language under another code may be the source
// itself (`en-US.json` for `en`, Ghost's empty `en/`), which `aside`
// names: only a variant partly filled and mostly with its keys as its
// values, as Zulip's en_GB is, is a target like the rest.
function textKeyedTarget(
  cwd: string,
  pattern: string,
  sourceLanguage: string,
):
  | { file: string; files: number }
  | { aside: string; tag: string }
  | { other: string }
  | { plural: true }
  | undefined {
  // The language and, where both write one, the script: zh_Hant is not
  // zh-Hans's file under another code.
  const parts = (tag: string) => {
    const [language, ...rest] = tag.toLowerCase().split(/[-_]/);
    return { language, script: rest.find((p) => /^[a-z]{4}$/.test(p)) };
  };
  const same = (a: string, b: string) => {
    const x = parts(a);
    const y = parts(b);
    return (
      x.language === y.language &&
      (x.script === undefined ||
        y.script === undefined ||
        x.script === y.script)
    );
  };
  const read: {
    file: string;
    tag: string;
    keys: string;
    sentences: number;
    size: number;
    filled: number;
    echoed: number;
  }[] = [];
  const filling = filesFilling(cwd, pattern);
  if (filling.length < 2) return undefined;
  // A file of no language is named once the files are this catalogue's.
  let other: string | undefined;
  for (const { code, file } of filling) {
    const tag = posixTag(code) ?? (LANGUAGE_RE.test(code) ? code : undefined);
    if (tag === undefined) {
      other ??= file;
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(stripBom(readFileSync(path.join(cwd, file), "utf8")));
    } catch {
      return undefined;
    }
    if (data === null || typeof data !== "object" || Array.isArray(data))
      return undefined;
    const entries = Object.entries(data);
    if (entries.some(([, v]) => typeof v !== "string")) return undefined;
    read.push({
      file,
      tag,
      keys: entries
        .map(([k]) => k)
        .sort()
        .join("\0"),
      sentences: entries.filter(([k]) => keyIsSentence(k)).length,
      size: entries.length,
      filled: entries.filter(([, v]) => (v as string).trim() !== "").length,
      echoed: entries.filter(([k, v]) => k === v).length,
    });
  }
  if (read.some((r) => r.keys !== read[0]!.keys)) return undefined;
  // A plural's forms are keys of their own (`{count} item_one`), whose
  // English no key holds (#999).
  if (read[0]!.size === 0 || read[0]!.sentences * 2 < read[0]!.size)
    return undefined;
  if (read[0]!.keys.split("\0").some((k) => PLURAL_SUFFIX_RE.test(k)))
    return { plural: true };
  if (other) return { other };
  const own = read.filter((r) => same(r.tag, sourceLanguage));
  const source = own.find(
    (r) => r.filled === 0 || r.filled === r.size || r.echoed * 2 <= r.filled,
  );
  if (source) return { aside: source.file, tag: source.tag };
  const chosen = read
    .filter((r) => !own.includes(r))
    .sort((a, b) => b.filled - a.filled || a.file.localeCompare(b.file))[0];
  return chosen && { file: chosen.file, files: read.length };
}

// The target `.po` whose msgids stand for the source's where no template
// and no source-language file is committed (#996): among the files
// msgmerged last, by the newest POT-Creation-Date (a file another tool
// regenerated alone, paperless-ngx's en_US, is current where 47 stale
// ones are not), the one holding the most msgids; and how many msgids the
// other current files hold that it lacks.
function sourceFromTargets(
  cwd: string,
  pattern: string,
): { file: string; lacking: number; older: number } | undefined {
  const read = patternFiles(cwd, pattern)
    .filter((file) => statSync(path.join(cwd, file)).isFile())
    .map((file) => {
      const text = readFileSync(path.join(cwd, file), "utf8");
      const ids = new Set(
        gettextToEntries(text, { type: "x" }).map((e) => e.id),
      );
      const date = Date.parse(
        (/"POT-Creation-Date:\s*([^"\\]*)/.exec(text)?.[1] ?? "")
          .trim()
          .replace(" ", "T")
          .replace(/([+-]\d\d)(\d\d)$/, "$1:$2"),
      );
      return { file, ids, date: Number.isNaN(date) ? undefined : date };
    });
  const usable = read.filter((r) => r.ids.size > 0);
  if (usable.length === 0) return undefined;
  const dates = usable.flatMap((r) => (r.date === undefined ? [] : [r.date]));
  const newest = dates.length > 0 ? Math.max(...dates) : undefined;
  const pool =
    newest === undefined ? usable : usable.filter((r) => r.date === newest);
  const chosen = [...pool].sort(
    (a, b) => b.ids.size - a.ids.size || a.file.localeCompare(b.file),
  )[0]!;
  const current = new Set(pool.flatMap((r) => [...r.ids]));
  // What only older catalogues hold, likely removed since.
  const older = new Set(
    usable.flatMap((r) => [...r.ids]).filter((id) => !current.has(id)),
  );
  return {
    file: chosen.file,
    lacking: current.size - chosen.ids.size,
    older: older.size,
  };
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
  skipped: { file: string; code: string }[];
} {
  const languageFiles: Record<string, string> = {};
  const found = new Set<string>();
  const skipped: { file: string; code: string }[] = [];
  for (const { code, file } of filesFilling(cwd, pattern)) {
    const tag = posixTag(code);
    if (tag) {
      languageFiles[tag] = code;
      found.add(tag);
    } else if (LANGUAGE_RE.test(code)) found.add(code);
    else skipped.push({ file, code });
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
