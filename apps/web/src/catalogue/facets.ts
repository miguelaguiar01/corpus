import type { FieldDeclaration } from "@corpus/contract";

export type Facet =
  | {
      kind: "enum";
      key: string;
      field: string;
      label: string;
      options: string[];
    }
  | { kind: "flag"; key: string; field: string; label: string }
  | { kind: "ref"; key: string; field: string; label: string }
  | { kind: "type"; key: "type"; options: string[] }
  | { kind: "state"; key: "state"; options: string[] }
  | { kind: "language"; key: "language"; options: string[] }
  | { kind: "archived"; key: "archived" };

// The metadata fields a project actually declares — used to reject
// unknown facet params before they reach a SQL json path (§5).
export function declaredMetadataFields(
  declarations: ProjectDeclarations,
): Set<string> {
  const fields = new Set<string>();
  for (const type of Object.values(declarations ?? {})) {
    for (const field of Object.keys(type)) fields.add(field);
  }
  return fields;
}

export type ProjectDeclarations = Record<
  string,
  Record<string, FieldDeclaration>
> | null;

// Facets are generated from the declarations (§5) plus the built-ins, so a
// newly declared field appears with zero UI work (§9.2). Metadata fields
// are keyed `meta.<field>` to avoid colliding with built-in keys.
export function deriveFacets(
  declarations: ProjectDeclarations,
  types: string[],
  languages: string[],
): Facet[] {
  const facets: Facet[] = [{ kind: "type", key: "type", options: types }];

  const seen = new Set<string>();
  for (const fields of Object.values(declarations ?? {})) {
    for (const [field, decl] of Object.entries(fields)) {
      if (seen.has(field)) continue;
      seen.add(field);
      const key = `meta.${field}`;
      const label = decl.description || field;
      if (decl.type === "enum") {
        facets.push({ kind: "enum", key, field, label, options: decl.values });
      } else if (decl.type === "flag") {
        facets.push({ kind: "flag", key, field, label });
      } else if (decl.type === "ref" || decl.type === "list<ref>") {
        facets.push({ kind: "ref", key, field, label });
      }
    }
  }

  facets.push(
    {
      kind: "state",
      key: "state",
      options: ["untranslated", "translated", "verified"],
    },
    { kind: "language", key: "language", options: languages },
    { kind: "archived", key: "archived" },
  );
  return facets;
}
