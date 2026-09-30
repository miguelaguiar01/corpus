// Client-repo configuration (§3). The CLI reads declared sources; it
// never discovers strings.
import { z } from "zod";
import { entityTypeDeclarationSchema } from "./snapshot";
import {
  fieldDeclarationSchema,
  identifier,
  languageCode,
  librarySchema,
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
// `{ns}` only where the ids are prefixed with it, and a pull strips it
// again (#854).
const noNamespace = <T extends z.ZodType<string>>(adapter: string, path: T) =>
  path.refine((p) => !p.includes("{ns}"), {
    message: `${adapter} does not read {ns}: only messages, table, fluent and android do`,
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

const messagesFields = {
  adapter: z.literal("messages"),
  type: identifier(),
  // The library the files are written for (§3, §5); plain ICU when
  // absent. `syntax` is the old name, accepted until 1.0.
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
  languageFiles,
};
const tableFields = {
  adapter: z.literal("table"),
  type: identifier(),
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
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
};

// Fluent `.ftl` (#597): messages as ICU, a select as a plural or select.
const fluentFields = {
  adapter: z.literal("fluent"),
  type: identifier(),
  languageFiles,
};

// XLIFF 1.2 and 2.0 (#667): a file per language; Angular's source file
// has no language in its name, so `sourcePath` names it apart.
const xliffSchema = z.looseObject({
  adapter: z.literal("xliff"),
  type: identifier(),
  path: noNamespace("xliff", langPattern),
  sourcePath: noNamespace("xliff", z.string().min(1)).optional(),
  languageFiles,
});

// gettext `.po` (#668): a file per language, the `.pot` or the source
// language's `.po` as the source; printf unless the library says else.
const gettextSchema = z.looseObject({
  adapter: z.literal("gettext"),
  type: identifier(),
  path: noNamespace("gettext", langPattern),
  sourcePath: noNamespace("gettext", z.string().min(1)).optional(),
  library: librarySchema.optional(),
  languageFiles,
});

// Qt Linguist `.ts` (#740): a file per language, `lupdate`'s template
// or the source language's own file as the source; qt's placeholders
// unless the library says else.
const qtTsSchema = z.looseObject({
  adapter: z.literal("qt-ts"),
  type: identifier(),
  path: noNamespace("qt-ts", langPattern),
  sourcePath: noNamespace("qt-ts", z.string().min(1)).optional(),
  library: librarySchema.optional(),
  languageFiles,
});

// Rails I18n's YAML (#752): a file per language, the language as its
// root key; rails's placeholders unless the library says else.
const yamlSchema = z.looseObject({
  adapter: z.literal("yaml"),
  type: identifier(),
  path: noNamespace("yaml", langPattern),
  library: librarySchema.optional(),
  languageFiles,
});

// Apple's String Catalog (#727): one `.xcstrings` holding every
// language, so its path has no {lang}; printf unless the library says
// else.
const xcstringsSchema = z.looseObject({
  adapter: z.literal("xcstrings"),
  type: identifier(),
  path: noNamespace(
    "xcstrings",
    z
      .string()
      .min(1)
      .refine((p) => !p.includes("{lang}"), {
        message:
          "a String Catalog holds every language in one file: its path has no {lang}",
      }),
  ),
  library: librarySchema.optional(),
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
  yamlSchema,
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
    ...mergeField,
  }),
  xliffSchema,
  gettextSchema,
  xcstringsSchema,
  qtTsSchema,
  yamlSchema,
  execSchema,
]);

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
      // The server fills a writable source's pattern with the source
      // language's tag when it places a proposal (#657).
      if (Object.hasOwn(files, c.sourceLanguage))
        issue(
          `the source language ${c.sourceLanguage} keeps its tag as its file's name; languageFiles maps target languages`,
        );
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
