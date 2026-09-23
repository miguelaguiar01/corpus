import {
  placeholderFormatsOf,
  placeholderWrittenOf,
  placeholdersOf,
  pluralArgsOf,
  type Example,
  type FieldDeclaration,
  type StringResponse,
  type Library,
} from "@corpus/contract";

// Every value a source takes, placeholders then counts, in source order,
// with what the type declares for the slot (§5) and the first example's
// value per language (§7): what a translator reads off the chips, for
// an agent that has no chips.
export function slotsOf(
  source: string,
  declarations: Record<string, FieldDeclaration>,
  examples: Example[] | null | undefined,
  sourceLanguage: string,
  syntax: Library = "icu",
): StringResponse["slots"] {
  const declared: Record<string, { description: string; role?: string }> = {};
  for (const declaration of Object.values(declarations)) {
    if (declaration.type === "placeholders")
      Object.assign(declared, declaration.slots);
  }
  const example = examples?.[0];
  const names = [...placeholdersOf(source, syntax)];
  const formats = placeholderFormatsOf(source, syntax);
  const written = placeholderWrittenOf(source, syntax);
  for (const arg of pluralArgsOf(source, syntax)) {
    if (!names.includes(arg)) names.push(arg);
  }
  return names.map((name) => {
    const values: Record<string, string> = {};
    const own = example?.values[name];
    if (own !== undefined) values[sourceLanguage] = own;
    for (const [language, map] of Object.entries(
      example?.valuesByLanguage ?? {},
    )) {
      const value = map[name];
      if (value !== undefined) values[language] = value;
    }
    return {
      name,
      description: declared[name]?.description ?? null,
      role: declared[name]?.role ?? null,
      format: formats.get(name) ?? null,
      written: written.get(name) ?? null,
      values,
    };
  });
}
