import type { MetadataValue, StringEntry } from "@corpus/contract";

export type TableOptions = {
  type: string;
  map: { id: string; text: string };
};

// Array of records + an id/text field map -> snapshot string entries
// (§3). Fields outside the map carry over as metadata. Every failure
// names the offending record so a malformed table can't silently drop
// or merge strings; duplicate ids within the source are rejected to
// keep ids the stable identity (§4).
export function tableToEntries(
  data: unknown,
  options: TableOptions,
): StringEntry[] {
  if (!Array.isArray(data)) {
    throw new Error("table: source must be an array of records");
  }
  const { id: idField, text: textField } = options.map;
  const entries: StringEntry[] = [];
  const seen = new Set<string>();

  data.forEach((record, index) => {
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      throw new Error(`table: record at index ${index} is not an object`);
    }
    const row = record as Record<string, unknown>;
    const id = requireString(row[idField], idField, index);
    const source = requireString(row[textField], textField, index);
    if (seen.has(id)) {
      throw new Error(
        `table: duplicate id ${JSON.stringify(id)} at index ${index}`,
      );
    }
    seen.add(id);

    const metadata = toMetadata(row, idField, textField);
    entries.push(
      metadata === undefined
        ? { id, type: options.type, source }
        : { id, type: options.type, source, metadata },
    );
  });

  return entries;
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== "string") {
    throw new Error(
      `table: record at index ${index} field ${JSON.stringify(field)} must be a string`,
    );
  }
  return value;
}

function toMetadata(
  row: Record<string, unknown>,
  idField: string,
  textField: string,
): Record<string, MetadataValue> | undefined {
  const metadata: Record<string, MetadataValue> = {};
  let has = false;
  for (const [key, value] of Object.entries(row)) {
    if (key === idField || key === textField) continue;
    if (!isMetadataValue(value)) {
      throw new Error(
        `table: metadata field ${JSON.stringify(key)} must be a string, boolean, or string[]`,
      );
    }
    metadata[key] = value;
    has = true;
  }
  return has ? metadata : undefined;
}

function isMetadataValue(value: unknown): value is MetadataValue {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((v) => typeof v === "string"))
  );
}
