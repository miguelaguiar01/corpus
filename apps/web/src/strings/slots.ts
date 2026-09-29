import {
  argIndexOf,
  partsOf,
  type Example,
  type FieldDeclaration,
  type StringResponse,
  type Library,
} from "@corpus/contract";

// A printf slot is a position: its chips and slots read in argument
// order, a plural that prints none of its argument among them (#739).
// Other libraries keep the source's order. Sorts in place.
export function inPositionOrder(names: string[], syntax: Library): string[] {
  if (syntax !== "printf") return names;
  const position = (name: string) =>
    /^\d+$/.test(name) ? Number(name) : Number.POSITIVE_INFINITY;
  return names.sort((a, b) => position(a) - position(b));
}

// Every value a source takes, placeholders then counts, in source order
// (under printf, in position order, #739),
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
  const declared = Object.create(null) as Record<
    string,
    { description: string; role?: string }
  >;
  for (const declaration of Object.values(declarations)) {
    if (declaration.type === "placeholders")
      Object.assign(declared, declaration.slots);
  }
  const example = examples?.[0];
  const { placeholders, formats, written, plurals } = partsOf(source, syntax);
  const names = [...placeholders];
  // A printf plural on `argN` is the Nth argument, one slot (#735).
  for (const plural of plurals) {
    const arg = syntax === "printf" ? (argIndexOf(plural) ?? plural) : plural;
    if (!names.includes(arg)) names.push(arg);
  }
  inPositionOrder(names, syntax);
  return names.map((name) => {
    const values: Record<string, string> = {};
    const own =
      example && Object.hasOwn(example.values, name)
        ? example.values[name]
        : undefined;
    if (own !== undefined) values[sourceLanguage] = own;
    for (const [language, map] of Object.entries(
      example?.valuesByLanguage ?? {},
    )) {
      const value = Object.hasOwn(map, name) ? map[name] : undefined;
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
