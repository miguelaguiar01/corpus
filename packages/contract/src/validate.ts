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
// the target and none may be added, wherever it moves, unless the
// string's type is read as HTML (`richText: "html"`), where a tag is
// markup the translation may write its own way.
// Errors are data (code + params); callers render them through their
// own message catalog.
import {
  parseIcu,
  pluralCategoriesOf,
  printfVerbOf,
  type IcuNode,
  tagIdentity,
} from "./icu";
import type { Library, RichText } from "./strings";

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
  // by their order; `indexed` is the index form in the source's style,
  // `%n$` when the source writes one and Go's `%[n]` otherwise.
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
  // How many placeholders the text writes, positions repeated included:
  // fewer than the source's is what a dropped verb looks like (#614).
  count: number;
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
    count: 0,
  },
): Shape {
  for (const node of nodes) {
    if (node.kind === "placeholder") {
      shape.placeholders.add(node.name);
      shape.order.push(node.name);
      shape.count += 1;
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
  options: { richText?: RichText } = {},
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
    // Go's fmt has no `%n$`, so the hint is Go's `%[n]` unless the
    // source itself writes a `%n$` index, as C, Java and Android do.
    const cStyle = [...expected.written.values()].some((w) =>
      /^%\d+\$/.test(w),
    );
    // The verb is the modifier and the letter together: `%ld` against
    // `%lu` is a changed verb (#614).
    const verbOf = (written: string) => printfVerbOf(written) ?? written;
    const changed: Extract<ValidationError, { code: "changed-verb" }>[] = [];
    for (const [name, written] of expected.written) {
      const got = actual.written.get(name);
      if (got === undefined || verbOf(got) === verbOf(written)) continue;
      changed.push({
        code: "changed-verb",
        name,
        expected: written,
        actual: got,
        indexed: cStyle ? `%n$${verbOf(got)}` : `%[n]${verbOf(got)}`,
      });
    }
    // One dropped verb shifts every verb after it one place: read by
    // position that is a changed verb at each place from the drop on and
    // a missing last, and it is said as the one omission it is (#614).
    // Anything else, a reorder or a drop beside a change, is said as it
    // reads.
    const drop = droppedVerb(expected, actual, changed, errors, verbOf);
    if (drop) {
      errors.length = 0;
      errors.push(drop);
    } else {
      errors.push(...changed);
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
  if (options.richText !== "html") {
    for (const name of expected.tags) {
      if (!actual.tags.has(name)) errors.push({ code: "missing-tag", name });
    }
    for (const name of actual.tags) {
      if (!expected.tags.has(name))
        errors.push({ code: "unexpected-tag", name });
    }
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

// The one omission a shifted tail is (#614): the translation writes one
// verb fewer, the only missing position is the source's last, every
// verb from the first changed position on is the source's next verb,
// and nothing is unexpected. Then the source's verb at the first changed
// position is what was dropped. Undefined for any other reading.
function droppedVerb(
  expected: Shape,
  actual: Shape,
  changed: Extract<ValidationError, { code: "changed-verb" }>[],
  errors: ValidationError[],
  verbOf: (written: string) => string,
): ValidationError | undefined {
  if (actual.count !== expected.count - 1 || changed.length === 0) return;
  const positions = [...expected.written.keys()].map(Number);
  const last = Math.max(...positions);
  const missing = errors.filter((e) => e.code === "missing-placeholder");
  if (errors.length !== missing.length) return;
  if (missing.length !== 1 || missing[0]!.name !== String(last)) return;
  const first = Math.min(...changed.map((c) => Number(c.name)));
  for (let n = first; n < last; n++) {
    const got = actual.written.get(String(n));
    const next = expected.written.get(String(n + 1));
    if (got === undefined || next === undefined || verbOf(got) !== verbOf(next))
      return;
  }
  const written = expected.written.get(String(first));
  return {
    code: "missing-placeholder",
    name: String(first),
    ...(written ? { written } : {}),
  };
}
