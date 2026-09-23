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
import { parseIcu, pluralCategoriesOf, type IcuNode, tagIdentity } from "./icu";
import type { Library } from "./strings";

export type ValidationError =
  | {
      code: "invalid-icu";
      where: "source" | "target";
      message: string;
      position: number;
    }
  // `written` is the placeholder as the source or the target writes it
  // when that is not `{name}` (printf's `%s`), for the message.
  | { code: "missing-placeholder"; name: string; written?: string }
  | { code: "unexpected-placeholder"; name: string; written?: string }
  | { code: "unknown-select"; arg: string }
  | { code: "missing-branch"; arg: string; key: string }
  | { code: "unexpected-branch"; arg: string; key: string }
  | { code: "unknown-plural"; arg: string }
  | { code: "missing-category"; arg: string; key: string }
  | { code: "unexpected-category"; arg: string; key: string }
  // A formatted placeholder written with another type, or with none
  // (`actual: null`); the style is the translator's (#555).
  | {
      code: "unexpected-format";
      name: string;
      expected: string;
      actual: string | null;
    }
  | { code: "missing-tag"; name: string }
  | { code: "unexpected-tag"; name: string }
  // printf (#594): the verb at a position prints another type than the
  // source's (`%s` where the source has `%d`), which is what a verb
  // moved without an index looks like, since unindexed verbs are named
  // by their order; `indexed` is the index form in the source's style.
  | {
      code: "changed-verb";
      name: string;
      expected: string;
      actual: string;
      indexed: string;
    };

// A plural missing a category its language uses is incomplete rather
// than invalid (#556): ICU falls back to `other`, and a many-language
// catalogue ships that way. It rides beside the result, apart, and an
// editor warns where it would have refused.
export type ValidationResult =
  | { ok: true; incomplete?: ValidationError[] }
  | { ok: false; errors: ValidationError[]; incomplete?: ValidationError[] };

type Shape = {
  placeholders: Set<string>;
  formats: Map<string, string>;
  selects: Map<string, Set<string>>;
  plurals: Map<string, Set<string>>;
  tags: Set<string>;
  // printf: each verb as written, by position, and the positions in
  // the order they appear (#594).
  written: Map<string, string>;
  order: string[];
};

function shapeOf(
  nodes: IcuNode[],
  shape: Shape = {
    placeholders: new Set(),
    formats: new Map(),
    selects: new Map(),
    plurals: new Map(),
    tags: new Set(),
    written: new Map(),
    order: [],
  },
): Shape {
  for (const node of nodes) {
    if (node.kind === "placeholder") {
      shape.placeholders.add(node.name);
      shape.order.push(node.name);
      if (node.written && !shape.written.has(node.name))
        shape.written.set(node.name, node.written);
      if (node.format && !shape.formats.has(node.name)) {
        shape.formats.set(node.name, node.format.type);
      }
    }
    if (node.kind === "tag") {
      shape.tags.add(tagIdentity(node));
      shapeOf(node.children, shape);
    }
    // A form's placeholders are the message's; how many forms there are
    // is the project's rule to decide, not Corpus's (#495).
    if (node.kind === "forms") {
      for (const branch of node.branches) shapeOf(branch, shape);
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
  syntax: Library = "icu",
): ValidationResult {
  const parsedSource = parseIcu(source, syntax);
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
  const parsedTarget = parseIcu(target, syntax);
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

  const writtenAs = (shape: Shape, name: string) => {
    const written = shape.written.get(name);
    return written ? { written } : {};
  };
  for (const name of expectedValues) {
    if (!actualValues.has(name))
      errors.push({
        code: "missing-placeholder",
        name,
        ...writtenAs(expected, name),
      });
  }
  for (const name of actual.placeholders) {
    if (!expectedValues.has(name))
      errors.push({
        code: "unexpected-placeholder",
        name,
        ...writtenAs(actual, name),
      });
  }
  if (syntax === "printf") {
    const goStyle = [...expected.written.values()].some(
      (w) => /^%\[/.test(w) || /v$/.test(w),
    );
    for (const [name, written] of expected.written) {
      const got = actual.written.get(name);
      if (got === undefined || got.slice(-1) === written.slice(-1)) continue;
      const letter = got.slice(-1);
      errors.push({
        code: "changed-verb",
        name,
        expected: written,
        actual: got,
        indexed: goStyle ? `%[n]${letter}` : `%n$${letter}`,
      });
    }
  }
  for (const [name, type] of expected.formats) {
    if (!actual.placeholders.has(name)) continue;
    const got = actual.formats.get(name) ?? null;
    if (got !== type) {
      errors.push({
        code: "unexpected-format",
        name,
        expected: type,
        actual: got,
      });
    }
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

  const incomplete = errors.filter((e) => e.code === "missing-category");
  const invalid = errors.filter((e) => e.code !== "missing-category");
  if (invalid.length === 0) {
    return incomplete.length === 0 ? { ok: true } : { ok: true, incomplete };
  }
  return incomplete.length === 0
    ? { ok: false, errors: invalid }
    : { ok: false, errors: invalid, incomplete };
}
