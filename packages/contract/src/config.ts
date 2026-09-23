// Client-repo configuration (§3). The CLI reads declared sources; it
// never discovers strings.
import { z } from "zod";
import { entityTypeDeclarationSchema } from "./snapshot";
import {
  fieldDeclarationSchema,
  identifier,
  languageCode,
  librarySchema,
} from "./strings";

// A pattern names one file per language with `{lang}`; it may also carry
// `{ns}`, one path segment, for a layout with one file per namespace
// (i18next's `locales/{lang}/{ns}.json`), which prefixes the ids the
// file contributes with `ns:` (#513). A source may name several
// patterns, all sharing its type and library.
const langPattern = z
  .string()
  .refine((p) => p.includes("{lang}"), "path must contain {lang}");
const patterns = <T extends z.ZodType<string>>(pattern: T) =>
  z.union([pattern, z.array(pattern).min(1)]);

const messagesFields = {
  adapter: z.literal("messages"),
  type: identifier(),
  // The library the files are written for (§3, §5); plain ICU when
  // absent. `syntax` is the old name, accepted until 1.0.
  library: librarySchema.optional(),
  syntax: librarySchema.optional(),
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
});

// What a config file declares.
export const sourceInputSchema = z.discriminatedUnion("adapter", [
  z.looseObject({ ...messagesFields, path: patterns(langPattern) }),
  z.looseObject({ ...tableFields, path: patterns(z.string().min(1)) }),
  execSchema,
]);

// What the CLI works on once the patterns are expanded: one path per
// source, and the namespace a `{ns}` pattern captured, if any.
export const sourceSchema = z.discriminatedUnion("adapter", [
  z.looseObject({
    ...messagesFields,
    path: langPattern,
    namespace: z.string().min(1).optional(),
  }),
  z.looseObject({
    ...tableFields,
    path: z.string().min(1),
    namespace: z.string().min(1).optional(),
  }),
  execSchema,
]);

const configFields = {
  project: identifier(),
  server: z.string().min(1),
  sourceLanguage: languageCode(),
  languages: z.array(languageCode()).min(1),
  stringTypes: z
    .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
    .optional(),
  // One sentence per string type on voice and register (§5); a map of
  // its own so it cannot collide with a metadata field named `note`.
  typeNotes: z.record(z.string(), z.string().min(1)).optional(),
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
  );

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
