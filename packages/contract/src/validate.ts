// Translation validation rules (§5, §7, §15), pure and shared by the
// editor and the server: the target must parse under the ICU subset;
// every source placeholder must survive and none may be added; a target
// may collapse a select into plain text, but any select it keeps must be
// on an argument the source selects on, with the same branch keys.
// Errors are data (code + params); callers render them through their
// own message catalog.
import { parseIcu, type IcuNode } from "./icu";

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
  | { code: "unexpected-branch"; arg: string; key: string };

export type ValidationResult =
  { ok: true } | { ok: false; errors: ValidationError[] };

type Shape = { placeholders: Set<string>; selects: Map<string, Set<string>> };

function shapeOf(
  nodes: IcuNode[],
  shape: Shape = { placeholders: new Set(), selects: new Map() },
): Shape {
  for (const node of nodes) {
    if (node.kind === "placeholder") shape.placeholders.add(node.name);
    if (node.kind === "select") {
      const keys = shape.selects.get(node.arg) ?? new Set<string>();
      for (const key of Object.keys(node.branches)) keys.add(key);
      shape.selects.set(node.arg, keys);
      for (const branch of Object.values(node.branches)) shapeOf(branch, shape);
    }
  }
  return shape;
}

export function validateTranslation(
  source: string,
  target: string,
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

  for (const name of expected.placeholders) {
    if (!actual.placeholders.has(name))
      errors.push({ code: "missing-placeholder", name });
  }
  for (const name of actual.placeholders) {
    if (!expected.placeholders.has(name))
      errors.push({ code: "unexpected-placeholder", name });
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
