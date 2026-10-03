// Client-repo configuration (§3). The CLI reads declared sources; it
// never discovers strings.
import { z } from "zod";
import { entityTypeDeclarationSchema } from "./snapshot";
import {
  fieldDeclarationSchema,
  identifier,
  languageCode,
  configLibrarySchema,
  PLURAL_CATEGORIES,
  richTextSchema,
} from "./strings";

// A pattern names one file per language with `{lang}`; it may also carry
// `{ns}`, one or more path segments anchored by the literals around it,
// for a layout with one file per namespace (i18next's
// `locales/{lang}/{ns}.json`) or per component (`src/{ns}/i18n/{lang}.json`),
// which prefixes the ids the file contributes with `ns:`, the capture
// kept as written (#513). A source may name several patterns, all
// sharing its type and library.
const langPattern = z
  .string()
  .refine((p) => p.includes("{lang}"), "path must contain {lang}");
const oneSourcePath = (adapter: string) =>
  z
    .string({
      error: (issue) =>
        Array.isArray(issue.input)
          ? `${adapter} takes one sourcePath per source`
          : undefined,
    })
    .min(1);
// A source that reads one file per language takes one pattern; an array,
// which only a merged catalogue takes, is refused by that rule (#1020).
const onePattern = (adapter: string) =>
  z
    .string({
      error: (issue) =>
        Array.isArray(issue.input)
          ? `${adapter} takes one path pattern per source; declare one source per pattern (only messages, table, fluent, android and yaml take an array)`
          : undefined,
    })
    .refine((p) => p.includes("{lang}"), "path must contain {lang}");
// `{ns}` only where a catalogue is laid out one file per namespace
// (#854); any other source takes a fixed `namespace` (#998).
const noNamespace = <T extends z.ZodType<string>>(adapter: string, path: T) =>
  path.refine((p) => !p.includes("{ns}"), {
    message: `${adapter} does not read {ns}: only messages, table, fluent and android do; namespace: "<name>" prefixes this source's ids instead`,
  });
const patterns = <T extends z.ZodType<string>>(pattern: T) =>
  z.union([pattern, z.array(pattern).min(1)]);
// The code a file names a language by, where it is not the language's
// tag (#657): Hoppscotch keeps zh-CN in cn.json, qBittorrent sr-Latn in
// sr@latin.ts. The project's language is the tag; the file keeps its
// name.
const languageFiles = z
  .record(
    languageCode(),
    z
      .string()
      .regex(/^[^/\\{}]+$/, "a file's language code, no slash or brace"),
  )
  .optional();

// Keys a source that does not take them is told of by name, each with
// its own reason, rather than as unknown.
const SAID_ELSEWHERE = new Set([
  "sourcePath",
  "library",
  "syntax",
  "pluralRules",
  "namespace",
  "languageFiles",
  "merge",
]);

// The known key nearest a misspelt one, two edits at most.
function nearest(key: string, known: string[]): string | undefined {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j]!;
        row[j] = Math.min(
          row[j]! + 1,
          row[j - 1]! + 1,
          previous + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        previous = current;
      }
    }
    return row[b.length]!;
  };
  const ranked = known
    .map((k) => [k, distance(key.toLowerCase(), k.toLowerCase())] as const)
    .filter(([, d]) => d <= 2)
    .sort((x, y) => x[1] - y[1]);
  return ranked[0]?.[0];
}

// A target language's plural categories, where its runtime picks others
// than CLDR's tolerant reading (#997): `{ he: ["one", "two", "many",
// "other"] }`, `other` always among them.
const pluralRulesTable = z.record(
  languageCode(),
  z
    .array(z.enum(PLURAL_CATEGORIES))
    .min(1)
    .refine((categories) => categories.includes("other"), {
      message:
        "a plural's categories include other, which every runtime falls back to",
    })
    .refine((categories) => new Set(categories).size === categories.length, {
      message: "a category is named once",
    }),
);
// The table, or the runtime's own rule by name: `"default"`, vue-i18n's
// built-in rule, under which the forms are read by count (#1018), and
// `"cldr"`, easy_localization's `ignorePluralRules: false` (#961). Read
// by the input's kind, so a table's own error says where it is.
const pluralRules = z
  .custom<"default" | "cldr" | z.infer<typeof pluralRulesTable>>()
  .superRefine((value, ctx) => {
    const read =
      typeof value === "string"
        ? z
            .enum(["default", "cldr"], {
              error:
                'pluralRules is "default", vue-i18n\'s default rule, "cldr", easy_localization\'s ignorePluralRules: false, or a table of categories per language',
            })
            .safeParse(value)
        : pluralRulesTable.safeParse(value);
    if (!read.success)
      for (const issue of read.error.issues)
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
  })
  .optional();

// The target languages a source's strings take, where it ships fewer
// than the project (#1006): Transmission's Qt client has 35 of the GTK
// client's 89. Every string takes the source language.
const sourceLanguages = z.array(languageCode()).min(1).optional();

// A prefix for every id the source reads, `server:title` (#998), so two
// catalogues whose keys overlap share one project.
const namespace = z
  .string()
  .min(1)
  .regex(
    /^[^:\s]*$/,
    "a namespace holds no : or space, since : divides it from the key",
  )
  .optional();

const messagesFields = {
  adapter: z.literal("messages"),
  type: identifier(),
  // The library the files are written for (§3, §5); plain ICU when
  // absent. `syntax` is the old name, accepted until 1.0.
  library: configLibrarySchema.optional(),
  syntax: configLibrarySchema.optional(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
};
const tableFields = {
  adapter: z.literal("table"),
  type: identifier(),
  library: configLibrarySchema.optional(),
  pluralRules,
  namespace,
  languages: sourceLanguages,
  syntax: configLibrarySchema.optional(),
  // The module's default export, or the named export `export` names.
  export: z.string().min(1).optional(),
  // Fields beside id and text become metadata: all of them, or only
  // the ones `metadata` lists.
  map: z.looseObject({
    id: z.string().min(1),
    text: z.string().min(1),
    metadata: z.array(z.string().min(1)).optional(),
  }),
};
const execSchema = z.looseObject({
  adapter: z.literal("exec"),
  command: z.string().min(1),
  importCommand: z.string().min(1).optional(),
  // The import command honours CORPUS_PULL_CHECK=1 by reporting what
  // it would change and writing nothing, so `pull --check` may run it
  // (#659). Without it, a check never runs an import command.
  importCheck: z.boolean().optional(),
});

// Android's `res` directory (#596): `values/strings.xml` is the source
// and each `values-<qualifier>` a language; the library is android. A
// modular app's `res` directories, which Gradle merges, are a list of
// patterns, and a `{ns}` in one captures a Compose Multiplatform
// module's own `composeResources`, its ids `ns:name` (#989).
const androidFields = {
  adapter: z.literal("android"),
  type: identifier(),
  pluralRules,
  namespace,
  languages: sourceLanguages,
};

// Fluent `.ftl` (#597): messages as ICU, a select as a plural or select.
const fluentFields = {
  adapter: z.literal("fluent"),
  type: identifier(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
};

// XLIFF 1.2 and 2.0 (#667): a file per language; Angular's source file
// has no language in its name, so `sourcePath` names it apart.
const xliffSchema = z.looseObject({
  adapter: z.literal("xliff"),
  type: identifier(),
  path: noNamespace("xliff", onePattern("xliff")),
  sourcePath: noNamespace("xliff", oneSourcePath("xliff")).optional(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
});

// gettext `.po` (#668): a file per language, the `.pot` or the source
// language's `.po` as the source; printf unless the library says else.
const gettextSchema = z.looseObject({
  adapter: z.literal("gettext"),
  type: identifier(),
  path: noNamespace("gettext", onePattern("gettext")),
  sourcePath: noNamespace("gettext", oneSourcePath("gettext")).optional(),
  library: configLibrarySchema.optional(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
});

// Qt Linguist `.ts` (#740): a file per language, `lupdate`'s template
// or the source language's own file as the source; qt's placeholders
// unless the library says else.
const qtTsSchema = z.looseObject({
  adapter: z.literal("qt-ts"),
  type: identifier(),
  path: noNamespace("qt-ts", onePattern("qt-ts")),
  sourcePath: noNamespace("qt-ts", oneSourcePath("qt-ts")).optional(),
  library: configLibrarySchema.optional(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
});

// Rails I18n's YAML (#752): a file per language, the language as its
// root key; rails's placeholders unless the library says else.
// A source may list several patterns, the files Rails' `I18n.load_path`
// merges into one tree (#1024).
const yamlFields = {
  adapter: z.literal("yaml"),
  type: identifier(),
  library: configLibrarySchema.optional(),
  languageFiles,
  pluralRules,
  namespace,
  languages: sourceLanguages,
};

// Apple's String Catalog (#727): one `.xcstrings` holding every
// language, so its path has no {lang}; printf unless the library says
// else.
const xcstringsSchema = z.looseObject({
  adapter: z.literal("xcstrings"),
  type: identifier(),
  path: noNamespace(
    "xcstrings",
    z
      .string({
        error: (issue) =>
          Array.isArray(issue.input)
            ? "xcstrings takes one file per source; declare one source per file"
            : undefined,
      })
      .min(1)
      .refine((p) => !p.includes("{lang}"), {
        message:
          "a String Catalog holds every language in one file: its path has no {lang}",
      }),
  ),
  library: configLibrarySchema.optional(),
  pluralRules,
  namespace,
  languages: sourceLanguages,
});

// How the patterns of one source merge an id two of them hold (#953):
// "strict", one text in every file, or "last-wins", the later pattern's,
// as an app that merges its catalogues in order reads them.
const mergeField = {
  merge: z.enum(["strict", "last-wins"]).optional(),
};

// What a config file declares.
const sourceInputSchema = z.discriminatedUnion("adapter", [
  z.looseObject({
    ...messagesFields,
    path: patterns(langPattern),
    ...mergeField,
  }),
  z.looseObject({
    ...tableFields,
    path: patterns(z.string().min(1)),
    ...mergeField,
  }),
  z.looseObject({
    ...fluentFields,
    path: patterns(langPattern),
    ...mergeField,
  }),
  z.looseObject({
    ...androidFields,
    path: patterns(z.string().min(1)),
    ...mergeField,
  }),
  xliffSchema,
  gettextSchema,
  xcstringsSchema,
  qtTsSchema,
  z.looseObject({
    ...yamlFields,
    path: patterns(noNamespace("yaml", langPattern)),
    ...mergeField,
  }),
  execSchema,
]);

// What the CLI works on once the patterns are expanded: one path per
// source, and the namespace a `{ns}` pattern captured, if any.
const expanded = {
  namespace: z.string().min(1).optional(),
  // The patterns of one source share it: one catalogue (#661).
  group: z.number().int().optional(),
};
const sourceSchema = z.discriminatedUnion("adapter", [
  z.looseObject({
    ...messagesFields,
    path: langPattern,
    ...expanded,
    ...mergeField,
  }),
  z.looseObject({
    ...tableFields,
    path: z.string().min(1),
    ...expanded,
    ...mergeField,
  }),
  z.looseObject({
    ...fluentFields,
    path: langPattern,
    ...expanded,
    ...mergeField,
  }),
  z.looseObject({
    ...androidFields,
    path: z.string().min(1),
    ...expanded,
    // A config language read from its language's directory (#1007).
    languageDirs: z.record(z.string(), z.string()).optional(),
    ...mergeField,
  }),
  xliffSchema,
  gettextSchema,
  xcstringsSchema,
  qtTsSchema,
  z.looseObject({
    ...yamlFields,
    path: noNamespace("yaml", langPattern),
    ...expanded,
    ...mergeField,
  }),
  execSchema,
]);

// The adapters whose source-language file may be other than the
// pattern's: Angular's `messages.xlf`, a `.pot`, lupdate's template.
const READS_SOURCE_PATH = new Set(["xliff", "gettext", "qt-ts"]);

// The code a file fills a pattern's {lang} with, {ns} matching itself or
// any name: `templates` for `core/templates/{ns}.ftl` in
// `core/{lang}/{ns}.ftl`.
function fileCodeIn(pattern: string, file: string): string | undefined {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = pattern
    .split(/(\{lang\}|\{ns\})/)
    .map((part) =>
      part === "{lang}"
        ? "([^/]+)"
        : part === "{ns}"
          ? "(?:\\{ns\\}|[^/]+(?:/[^/]+)*)"
          : escape(part),
    )
    .join("");
  return new RegExp(`^${source}$`).exec(file)?.[1];
}

// The adapters whose sources map a language to its file's code.
const MAPS_LANGUAGE_FILES: string[] = sourceInputSchema.options.flatMap(
  (option) =>
    "languageFiles" in option.shape ? [option.shape.adapter.value] : [],
);

const configFields = {
  project: identifier(),
  server: z.string().min(1),
  sourceLanguage: languageCode(),
  languages: z.array(languageCode()).min(1),
  // Target languages that are variants of the source (#658), en-GB of
  // en: their seeds identical to the source count as translated.
  sourceVariants: z.array(languageCode()).optional(),
  stringTypes: z
    .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
    .optional(),
  // One sentence per string type on voice and register (§5); a map of
  // its own so it cannot collide with a metadata field named `note`.
  typeNotes: z.record(z.string(), z.string().min(1)).optional(),
  // The string types an HTML renderer reads (#622), a map of its own
  // for the same reason.
  richText: z.record(z.string(), richTextSchema).optional(),
  // The glossary files (§5), one per target language, `{lang}` in the
  // path; the repository owns them and pull never writes them.
  glossary: z
    .looseObject({
      path: z
        .string()
        .min(1)
        .refine((p) => p.includes("{lang}"), "path must contain {lang}"),
    })
    .optional(),
  entityTypes: z.record(z.string(), entityTypeDeclarationSchema).optional(),
  // `corpus check` (§3): directories to scan, path prefixes to skip, and
  // regex sources for texts that are not chrome (brand names, codes).
  check: z
    .looseObject({
      include: z.array(z.string().min(1)).optional(),
      ignore: z.array(z.string().min(1)).optional(),
      allow: z.array(z.string().min(1)).optional(),
    })
    .optional(),
};

export const corpusConfigSchema = z
  .looseObject({
    ...configFields,
    sources: z.array(sourceInputSchema).min(1),
  })
  .refine((c) => c.languages.includes(c.sourceLanguage), {
    message: "languages must include sourceLanguage",
    path: ["sourceLanguage"],
  })
  // A source that sets both names disagrees with itself; the config
  // says so rather than picking one.
  .refine(
    (c) =>
      c.sources.every(
        (source) =>
          (source.adapter !== "messages" && source.adapter !== "table") ||
          !(
            "library" in source &&
            source.library !== undefined &&
            "syntax" in source &&
            source.syntax !== undefined
          ),
      ),
    {
      message:
        "a source sets library or syntax, not both; syntax is the old name for library",
      path: ["sources"],
    },
  )
  .superRefine((c, ctx) => {
    for (const variant of c.sourceVariants ?? [])
      if (variant === c.sourceLanguage || !c.languages.includes(variant))
        ctx.addIssue({
          code: "custom",
          message: `sourceVariants names ${variant}, which is not a target language of languages`,
          path: ["sourceVariants"],
        });
    c.sources.forEach((source, index) => {
      const raw = source as Record<string, unknown>;
      const takes = (source as { languages?: string[] }).languages;
      for (const language of takes ?? [])
        if (!c.languages.includes(language))
          ctx.addIssue({
            code: "custom",
            message: `the source's languages name ${language}, which the project's languages do not list`,
            path: ["sources", index, "languages"],
          });
      // A key the source does not take is refused, never ignored (#998):
      // a misspelt one would do nothing without a word.
      const option = sourceInputSchema.options.find(
        (o) => o.shape.adapter.value === source.adapter,
      );
      const known = option ? Object.keys(option.shape) : [];
      for (const key of Object.keys(raw))
        if (
          raw[key] !== undefined &&
          !known.includes(key) &&
          !SAID_ELSEWHERE.has(key)
        ) {
          const near = nearest(key, known);
          ctx.addIssue({
            code: "custom",
            message: `${key} is no key of a${/^[aeiox]/.test(source.adapter) ? "n" : ""} ${source.adapter} source${near ? `; did you mean ${near}?` : ""}`,
            path: ["sources", index, key],
          });
        }
      if (source.adapter === "exec" && raw.namespace !== undefined)
        ctx.addIssue({
          code: "custom",
          message:
            "an exec source's entries carry their own ids; namespace does not apply",
          path: ["sources", index, "namespace"],
        });
      const paths = [raw.path].flat().filter((p) => typeof p === "string");
      if (
        raw.namespace !== undefined &&
        paths.some((p) => (p as string).includes("{ns}"))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "namespace and a {ns} pattern each prefix the source's ids; a source takes one of them",
          path: ["sources", index, "namespace"],
        });
      const rules = (source as { pluralRules?: unknown }).pluralRules;
      if (source.adapter === "exec" && rules !== undefined)
        ctx.addIssue({
          code: "custom",
          message:
            "an exec source's entries carry their own plural forms; pluralRules does not apply",
          path: ["sources", index, "pluralRules"],
        });
      if (
        (rules === "default" || rules === "cldr") &&
        source.adapter !== "exec"
      ) {
        const set = source as { library?: string; syntax?: string };
        // The library the build reads the source as, its adapter's own
        // where the config names none.
        const library =
          set.library ??
          set.syntax ??
          (
            {
              gettext: "printf",
              xcstrings: "printf",
              "qt-ts": "qt",
              yaml: "rails",
              android: "android",
              fluent: "fluent",
            } as Record<string, string>
          )[source.adapter] ??
          "icu";
        const [wants, rule] =
          rules === "default"
            ? ["vue", "vue-i18n's default rule"]
            : [
                "easy_localization",
                "easy_localization's ignorePluralRules: false",
              ];
        if (library !== wants)
          ctx.addIssue({
            code: "custom",
            message: `pluralRules: "${rules}" is ${rule}; this source's library is ${library}`,
            path: ["sources", index, "pluralRules"],
          });
      }
      const table =
        rules !== null && typeof rules === "object" && !Array.isArray(rules)
          ? Object.keys(rules)
          : [];
      for (const language of table)
        if (!c.languages.includes(language))
          ctx.addIssue({
            code: "custom",
            message: `pluralRules names ${language}, which languages does not list`,
            path: ["sources", index, "pluralRules", language],
          });
      if (
        "merge" in source &&
        source.merge !== undefined &&
        !Array.isArray(source.path)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "merge applies to a source whose path is a list of patterns; this one has a single path, or none",
          path: ["sources", index, "merge"],
        });
      // A library field the build does not read is refused, not ignored
      // (#860): syntax is the old name on messages and table alone,
      // xliff, fluent and android set their own, and an exec source's
      // entries carry theirs.
      // A sourcePath an adapter does not read is refused, not ignored
      // (#994): the source language's file is the pattern's, filled
      // through languageFiles.
      const given = (source as { sourcePath?: unknown }).sourcePath;
      if (typeof given === "string" && !READS_SOURCE_PATH.has(source.adapter)) {
        const pattern = (source as { path?: unknown }).path;
        const code = (Array.isArray(pattern) ? pattern : [pattern])
          .filter((p): p is string => typeof p === "string")
          .map((p) => fileCodeIn(p, given))
          .find((found) => found !== undefined);
        ctx.addIssue({
          code: "custom",
          message: !MAPS_LANGUAGE_FILES.includes(source.adapter)
            ? `${source.adapter} reads no sourcePath`
            : code === c.sourceLanguage ||
                (code !== undefined &&
                  (source as { languageFiles?: Record<string, string> })
                    .languageFiles?.[c.sourceLanguage] === code)
              ? `${source.adapter} reads no sourcePath; this one is the pattern's own source file, so drop it`
              : `${source.adapter} reads no sourcePath; map the source language with languageFiles: { ${c.sourceLanguage}: "${code ?? "<its file's code>"}" }`,
          path: ["sources", index, "sourcePath"],
        });
      }
      const set = source as { library?: unknown; syntax?: unknown };
      const field = (name: "library" | "syntax", message: string) =>
        ctx.addIssue({
          code: "custom",
          message,
          path: ["sources", index, name],
        });
      if (source.adapter === "exec") {
        for (const name of ["library", "syntax"] as const)
          if (set[name] !== undefined)
            field(
              name,
              `an exec source's entries carry their own library; ${name} does not apply`,
            );
      } else if (
        source.adapter === "xliff" ||
        source.adapter === "fluent" ||
        source.adapter === "android"
      ) {
        for (const name of ["library", "syntax"] as const)
          if (set[name] !== undefined)
            field(
              name,
              `${source.adapter} sets its own library; ${name} does not apply`,
            );
      } else if (
        source.adapter !== "messages" &&
        source.adapter !== "table" &&
        set.syntax !== undefined
      )
        field("syntax", `${source.adapter} reads library, not syntax`);
      const files = (source as { languageFiles?: Record<string, string> })
        .languageFiles;
      if (!files) return;
      const path = ["sources", index, "languageFiles"];
      const issue = (message: string) =>
        ctx.addIssue({ code: "custom", message, path });
      if (!MAPS_LANGUAGE_FILES.includes(source.adapter)) {
        issue(
          `languageFiles is for ${MAPS_LANGUAGE_FILES.slice(0, -1).join(", ")} and ${MAPS_LANGUAGE_FILES.at(-1)} sources`,
        );
        return;
      }
      for (const tag of Object.keys(files))
        if (!c.languages.includes(tag))
          issue(`languageFiles names ${tag}, which languages does not list`);
      const byCode = new Map<string, string>();
      for (const tag of c.languages) {
        const code = Object.hasOwn(files, tag) ? files[tag]! : tag;
        const other = byCode.get(code);
        if (other !== undefined)
          issue(`${other} and ${tag} would share the file of ${code}`);
        byCode.set(code, tag);
      }
    });
  });

// The config as written, and as loaded: the CLI expands every pattern
// into concrete sources when it reads the file (#513).
export type CorpusInput = z.infer<typeof corpusConfigSchema>;
export type Source = z.infer<typeof sourceSchema>;
export const loadedConfigSchema = z.looseObject({
  ...configFields,
  sources: z.array(sourceSchema).min(1),
});
export type CorpusConfig = z.infer<typeof loadedConfigSchema>;

export function defineCorpus(
  config: z.input<typeof corpusConfigSchema>,
): CorpusInput {
  return corpusConfigSchema.parse(config);
}
