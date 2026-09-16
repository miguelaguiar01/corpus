// The glossary (§5): per target language, the words that must stay the
// same across a project, read from a file the repository owns. Pure:
// the schema and the matcher, shared by the server and the CLI.
import { z } from "zod";

export const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  target: z.string().min(1),
  note: z.string().min(1).optional(),
});
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;

// One file per target language: an array of entries.
export const glossaryFileSchema = z.array(glossaryEntrySchema);
// In the snapshot and on the project: keyed by target language.
export const glossarySchema = z.record(z.string(), glossaryFileSchema);
export type Glossary = z.infer<typeof glossarySchema>;

// Case- and accent-insensitive comparison on whole words: "Vítima" in
// a source matches the term "vitima" and the term "vítima" alike.
export function foldTerm(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return foldTerm(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

// The entries whose term occurs in the source as whole words, in the
// glossary's order; a multi-word term matches as a run of words.
export function glossaryMatches(
  source: string,
  entries: GlossaryEntry[],
): GlossaryEntry[] {
  const haystack = words(source);
  return entries.filter((entry) => {
    const needle = words(entry.term);
    if (needle.length === 0 || needle.length > haystack.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      if (needle.every((w, j) => haystack[i + j] === w)) return true;
    }
    return false;
  });
}
