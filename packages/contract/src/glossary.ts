// The glossary (§5): per target language, the words that must stay the
// same across a project, read from a file the repository owns. Pure:
// the schema and the matcher, shared by the server and the CLI.
import { z } from "zod";
import { parseIcu, type IcuNode } from "./icu";
import type { Syntax } from "./strings";

const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  // Other surface forms of the term (plurals, agreements), each matched
  // as the term is; the entry still shows under its term.
  forms: z.array(z.string().min(1)).optional(),
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
// a source matches the term "vitima" and the term "vítima" alike. Only
// the Latin combining accents are dropped, so scripts whose marks are
// letters in their own right (Devanagari, Thai, kana voicing) keep them.
export function foldTerm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function words(text: string): string[] {
  // Marks stay inside a word, so a marked script does not split at them.
  return foldTerm(text).match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
}

// Scripts written without spaces between words: a term in one of them has
// no word boundary to match on, so it is matched as a run of characters.
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;

// The source's own words: the literal text of its ICU tree, never a
// placeholder name, a select argument or a branch key; a source that
// does not parse is read as plain text.
function literalText(source: string, syntax: Syntax): string {
  const parsed = parseIcu(source, syntax);
  if (!parsed.ok) return source;
  const parts: string[] = [];
  const walk = (nodes: IcuNode[]) => {
    for (const node of nodes) {
      if (node.kind === "literal") parts.push(node.text);
      else if (node.kind === "tag") walk(node.children);
      else if (node.kind === "select" || node.kind === "plural")
        for (const branch of Object.values(node.branches)) walk(branch);
    }
  };
  walk(parsed.nodes);
  return parts.join(" ");
}

// The entries whose term occurs in the source as whole words, in the
// glossary's order; a multi-word term matches as a run of words, and a
// term in a script written without spaces as a run of characters.
export function glossaryMatches(
  source: string,
  entries: GlossaryEntry[],
  syntax: Syntax = "icu",
): GlossaryEntry[] {
  const literal = literalText(source, syntax);
  const haystack = words(literal);
  const folded = foldTerm(literal);
  const occurs = (form: string) => {
    if (UNSPACED.test(form)) return folded.includes(foldTerm(form));
    const needle = words(form);
    if (needle.length === 0 || needle.length > haystack.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      if (needle.every((w, j) => haystack[i + j] === w)) return true;
    }
    return false;
  };
  return entries.filter((entry) =>
    [entry.term, ...(entry.forms ?? [])].some(occurs),
  );
}
