import { parseIcu, snapshotSchema, type Snapshot } from "@corpus/contract";

export type EntryError = { id: string; message: string };

export type ValidationResult =
  { ok: true; snapshot: Snapshot } | { ok: false; errors: EntryError[] };

// Server-side push validation (§8, §5, §4): contract shape, ICU subset on
// every source, unique string/entity ids, and refs resolving to entities
// in the same snapshot. Errors are per-entry so the CLI can point at the
// offending id; any error means nothing is applied.
export function validateSnapshot(body: unknown): ValidationResult {
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        id: entryIdFromPath(body, issue.path),
        message: `${issue.path.join(".")}: ${issue.message}`,
      })),
    };
  }

  const snapshot = parsed.data;
  const errors: EntryError[] = [];

  const entityIds = new Set<string>();
  for (const entity of snapshot.entities) {
    if (entityIds.has(entity.id)) {
      errors.push({ id: entity.id, message: "duplicate entity id" });
    }
    entityIds.add(entity.id);
  }

  const refFields = refFieldsByType(snapshot);
  const stringIds = new Set<string>();
  for (const entry of snapshot.strings) {
    if (stringIds.has(entry.id)) {
      errors.push({ id: entry.id, message: "duplicate string id" });
    }
    stringIds.add(entry.id);

    const icu = parseIcu(entry.source);
    if (!icu.ok) {
      const first = icu.errors[0];
      errors.push({
        id: entry.id,
        message: `invalid ICU at ${first?.position}: ${first?.message}`,
      });
    }

    for (const ref of refsOf(entry, refFields.get(entry.type))) {
      if (!entityIds.has(ref)) {
        errors.push({ id: entry.id, message: `ref ${ref} has no entity` });
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, snapshot };
}

function refFieldsByType(snapshot: Snapshot): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [type, fields] of Object.entries(snapshot.stringTypes ?? {})) {
    const refs = new Set<string>();
    for (const [field, decl] of Object.entries(fields)) {
      if (decl.type === "ref" || decl.type === "list<ref>") refs.add(field);
    }
    map.set(type, refs);
  }
  return map;
}

function refsOf(
  entry: Snapshot["strings"][number],
  refFields: Set<string> | undefined,
): string[] {
  if (!refFields || !entry.metadata) return [];
  const refs: string[] = [];
  for (const field of refFields) {
    const value = entry.metadata[field];
    if (typeof value === "string") refs.push(value);
    else if (Array.isArray(value)) refs.push(...value);
  }
  return refs;
}

function entryIdFromPath(body: unknown, path: PropertyKey[]): string {
  if (
    path[0] === "strings" &&
    typeof path[1] === "number" &&
    body &&
    typeof body === "object"
  ) {
    const entry = (body as { strings?: unknown[] }).strings?.[path[1]];
    if (entry && typeof entry === "object" && "id" in entry) {
      return String((entry as { id: unknown }).id);
    }
  }
  return "<snapshot>";
}
