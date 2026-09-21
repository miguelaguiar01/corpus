// Translation validation rules (§5, §7, §15), pure and shared by the
// editor and the server: the target must parse under the ICU subset;
// every source placeholder must survive and none may be added; a target
// may collapse a select into plain text, but any select it keeps must be
// on an argument the source selects on, with the same branch keys. A
// count the source pluralises on is a value like a placeholder: it must
// survive, as `{n}` or as a plural on n, and a target may pluralise any
// value the source has; with the target language given, a plural's
// categories must be the ones that language uses. A rich-text tag is a
// component the client renders: every tag in the source must occur in
// the target and none may be added, wherever it moves.
// Errors are data (code + params); callers render them through their
// own message catalog.
import { parseIcu, pluralCategoriesOf, type IcuNode } from "./icu";

export type ValidationError =
  | {
      code: "invalid-icu";
      where: "source" | "target";
      message: string;
      position: number;
    }
  | { code: "missing-placeholder"; name: string }
  | { code: "unexpected-placeholder"; name: string }
  | { code: "unknown-select"; arg: string }
  | { code: "missing-branch"; arg: string; key: string }
  | { code: "unexpected-branch"; arg: string; key: string }
  | { code: "unknown-plural"; arg: string }
  | { code: "missing-category"; arg: string; key: string }
  | { code: "unexpected-category"; arg: string; key: string }
  | { code: "missing-tag"; name: string }
  | { code: "unexpected-tag"; name: string };

export type ValidationResult =
  { ok: true } | { ok: false; errors: ValidationError[] };

type Shape = {
  placeholders: Set<string>;
  selects: Map<string, Set<string>>;
  plurals: Map<string, Set<string>>;
  tags: Set<string>;
};

function shapeOf(
  nodes: IcuNode[],
  shape: Shape = {
    placeholders: new Set(),
    selects: new Map(),
    plurals: new Map(),
    tags: new Set(),
  },
): Shape {
  for (const node of nodes) {
    if (node.kind === "placeholder") shape.placeholders.add(node.name);
    if (node.kind === "tag") {
      shape.tags.add(node.name);
      shapeOf(node.children, shape);
    }
    if (node.kind === "select" || node.kind === "plural") {
      const map = node.kind === "select" ? shape.selects : shape.plurals;
      const keys = map.get(node.arg) ?? new Set<string>();
      for (const key of Object.keys(node.branches)) keys.add(key);
      map.set(node.arg, keys);
      for (const branch of Object.values(node.branches)) shapeOf(branch, shape);
    }
  }
  return shape;
}

// The values a message uses: its placeholders and the counts it
// pluralises on. A select's argument is not one; it picks a branch.
function valuesOf(shape: Shape): Set<string> {
  return new Set([...shape.placeholders, ...shape.plurals.keys()]);
}

export function validateTranslation(
  source: string,
  target: string,
  language?: string,
): ValidationResult {
  const parsedSource = parseIcu(source);
  if (!parsedSource.ok) {
    return {
      ok: false,
      errors: parsedSource.errors.map((e) => ({
        code: "invalid-icu",
        where: "source",
        ...e,
      })),
    };
  }
  const parsedTarget = parseIcu(target);
  if (!parsedTarget.ok) {
    return {
      ok: false,
      errors: parsedTarget.errors.map((e) => ({
        code: "invalid-icu",
        where: "target",
        ...e,
      })),
    };
  }

  const expected = shapeOf(parsedSource.nodes);
  const actual = shapeOf(parsedTarget.nodes);
  const errors: ValidationError[] = [];
  const expectedValues = valuesOf(expected);
  const actualValues = valuesOf(actual);

  for (const name of expectedValues) {
    if (!actualValues.has(name))
      errors.push({ code: "missing-placeholder", name });
  }
  for (const name of actual.placeholders) {
    if (!expectedValues.has(name))
      errors.push({ code: "unexpected-placeholder", name });
  }
  for (const name of expected.tags) {
    if (!actual.tags.has(name)) errors.push({ code: "missing-tag", name });
  }
  for (const name of actual.tags) {
    if (!expected.tags.has(name)) errors.push({ code: "unexpected-tag", name });
  }
  const categories = language === undefined ? [] : pluralCategoriesOf(language);
  for (const [arg, keys] of actual.plurals) {
    if (!expectedValues.has(arg)) {
      errors.push({ code: "unknown-plural", arg });
      continue;
    }
    if (categories.length === 0) continue;
    for (const key of categories) {
      if (!keys.has(key)) errors.push({ code: "missing-category", arg, key });
    }
    for (const key of keys) {
      if (!key.startsWith("=") && !categories.includes(key))
        errors.push({ code: "unexpected-category", arg, key });
    }
  }
  for (const [arg, keys] of actual.selects) {
    const sourceKeys = expected.selects.get(arg);
    if (!sourceKeys) {
      errors.push({ code: "unknown-select", arg });
      continue;
    }
    for (const key of sourceKeys) {
      if (!keys.has(key)) errors.push({ code: "missing-branch", arg, key });
    }
    for (const key of keys) {
      if (!sourceKeys.has(key))
        errors.push({ code: "unexpected-branch", arg, key });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
