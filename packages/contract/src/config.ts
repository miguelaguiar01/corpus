// Client-repo configuration (§3). The CLI reads declared sources; it
// never discovers strings.
import { z } from "zod";
import { entityTypeDeclarationSchema } from "./snapshot";
import { fieldDeclarationSchema } from "./strings";

export const sourceSchema = z.discriminatedUnion("adapter", [
  z.looseObject({
    adapter: z.literal("messages"),
    type: z.string().min(1),
    path: z
      .string()
      .refine((p) => p.includes("{lang}"), "path must contain {lang}"),
  }),
  z.looseObject({
    adapter: z.literal("table"),
    type: z.string().min(1),
    path: z.string().min(1),
    map: z.looseObject({ id: z.string().min(1), text: z.string().min(1) }),
  }),
  z.looseObject({
    adapter: z.literal("exec"),
    command: z.string().min(1),
    importCommand: z.string().min(1).optional(),
  }),
]);

export const corpusConfigSchema = z
  .looseObject({
    project: z.string().min(1),
    server: z.string().min(1),
    sourceLanguage: z.string().min(1),
    languages: z.array(z.string().min(1)).min(1),
    stringTypes: z
      .record(z.string(), z.record(z.string(), fieldDeclarationSchema))
      .optional(),
    entityTypes: z.record(z.string(), entityTypeDeclarationSchema).optional(),
    sources: z.array(sourceSchema).min(1),
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
