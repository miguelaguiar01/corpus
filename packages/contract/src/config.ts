// Client-repo configuration (§3). The CLI reads declared sources; it
// never discovers strings.
import { z } from "zod";
import { entityTypeDeclarationSchema } from "./snapshot";
import { fieldDeclarationSchema, identifier, languageCode } from "./strings";

export const sourceSchema = z.discriminatedUnion("adapter", [
  z.looseObject({
    adapter: z.literal("messages"),
    type: identifier(),
    path: z
      .string()
      .refine((p) => p.includes("{lang}"), "path must contain {lang}"),
  }),
  z.looseObject({
    adapter: z.literal("table"),
    type: identifier(),
    path: z.string().min(1),
    // The module's default export, or the named export `export` names.
    export: z.string().min(1).optional(),
    // Fields beside id and text become metadata: all of them, or only
    // the ones `metadata` lists.
    map: z.looseObject({
      id: z.string().min(1),
      text: z.string().min(1),
      metadata: z.array(z.string().min(1)).optional(),
    }),
  }),
  z.looseObject({
    adapter: z.literal("exec"),
    command: z.string().min(1),
    importCommand: z.string().min(1).optional(),
  }),
]);

export const corpusConfigSchema = z
  .looseObject({
    project: identifier(),
    server: z.string().min(1),
    sourceLanguage: languageCode(),
    languages: z.array(languageCode()).min(1),
    stringTypes: z
      .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
      .optional(),
    entityTypes: z.record(z.string(), entityTypeDeclarationSchema).optional(),
    sources: z.array(sourceSchema).min(1),
    // `corpus check` (§3): directories to scan, path prefixes to skip, and
    // regex sources for texts that are not chrome (brand names, codes).
    check: z
      .looseObject({
        include: z.array(z.string().min(1)).optional(),
        ignore: z.array(z.string().min(1)).optional(),
        allow: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .refine((c) => c.languages.includes(c.sourceLanguage), {
    message: "languages must include sourceLanguage",
    path: ["sourceLanguage"],
  });

export type CorpusConfig = z.infer<typeof corpusConfigSchema>;
export type Source = z.infer<typeof sourceSchema>;

export function defineCorpus(
  config: z.input<typeof corpusConfigSchema>,
): CorpusConfig {
  return corpusConfigSchema.parse(config);
}
