import { expect, test } from "vitest";
import {
  branchingNodes,
  parseIcu,
  pluralArgsOf,
  pluralBranch,
  selectArgsOf,
} from "../icu";
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

test("examples reach every branch of every plural", () => {
  // §7 asks for an example per category. The selects have had this
  // since the fixture was written; the plural got its coverage by
  // accident of how it was authored (#490).
  for (const entry of moonlightManor.strings) {
    for (const arg of pluralArgsOf(entry.source)) {
      const parsed = parseIcu(entry.source);
      if (!parsed.ok) continue;
      const node = branchingNodes(parsed.nodes).find(
        (candidate) => candidate.kind === "plural" && candidate.arg === arg,
      );
      if (!node) continue;
      const declared = Object.keys(node.branches);
      const reached = new Set(
        (entry.examples ?? [])
          .map((example) => (example.values as Record<string, string>)[arg])
          .filter((value): value is string => value !== undefined)
          .map((value) =>
            pluralBranch(node.branches, value, moonlightManor.sourceLanguage),
          ),
      );
      for (const branch of declared) {
        expect(reached, `${entry.id}: ${arg} ${branch}`).toContain(branch);
      }
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
