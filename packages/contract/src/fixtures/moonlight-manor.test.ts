import { expect, test } from "vitest";
import { parseIcu, selectArgsOf } from "../icu";
import { snapshotSchema } from "../snapshot";
import { moonlightManor } from "./moonlight-manor";

test("the fixture validates against the snapshot schema", () => {
  expect(snapshotSchema.safeParse(moonlightManor).success).toBe(true);
});

test("round-trip loses nothing and reaches a byte-stable fixpoint", () => {
  const parsed = snapshotSchema.parse(moonlightManor);
  expect(parsed).toEqual(moonlightManor);
  const once = JSON.stringify(parsed);
  const twice = JSON.stringify(snapshotSchema.parse(JSON.parse(once)));
  expect(twice).toBe(once);
});

test("every metadata primitive appears in the declarations", () => {
  const kinds = new Set(
    Object.values(moonlightManor.stringTypes)
      .flatMap((fields) => Object.values(fields))
      .map((decl) => decl.type),
  );
  expect(kinds).toEqual(
    new Set(["enum", "flag", "text", "placeholders", "ref", "list<ref>"]),
  );
});

test("every source string parses under the ICU subset", () => {
  for (const entry of moonlightManor.strings) {
    expect(parseIcu(entry.source).ok, entry.id).toBe(true);
  }
});

test("examples cover both branches of every select", () => {
  for (const entry of moonlightManor.strings) {
    for (const arg of selectArgsOf(entry.source)) {
      const covered = new Set(
        (entry.examples ?? []).map(
          (example) => (example.values as Record<string, string>)[arg],
        ),
      );
      expect(covered.size, `${entry.id}: ${arg}`).toBeGreaterThanOrEqual(2);
    }
  }
});

test("every ref in metadata points at an entity in the fixture", () => {
  const entityIds = new Set(moonlightManor.entities.map((e) => e.id));
  for (const entry of moonlightManor.strings) {
    for (const value of Object.values(entry.metadata ?? {})) {
      const refs =
        typeof value === "string" && value.includes(":")
          ? [value]
          : Array.isArray(value)
            ? value
            : [];
      for (const ref of refs) {
        expect(entityIds.has(ref), `${entry.id} -> ${ref}`).toBe(true);
      }
    }
  }
});
