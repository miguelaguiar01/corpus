// Byte-precise edits to a JSON object file (§8): a value replaced, a
// property removed, a property added, and every other byte kept, so a
// pull or a proposal reads as the lines it changes. jsonc-parser gives
// the node offsets; the text is spliced here.
import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";
import { eolOf, lineIndent } from "./text";

const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

// An id from the server is data; these segments would walk into the
// prototype instead of the tree.
export function checkPath(path: string[]): void {
  if (path.some((segment) => UNSAFE_SEGMENTS.has(segment))) {
    throw new Error(
      `messages: id ${JSON.stringify(path.join("."))} is not a valid key path`,
    );
  }
}

// The node at a key path, a segment into a list read as its index
// (#1053); undefined where the path leads nowhere.
export function nodeAt(
  node: Node | undefined,
  path: string[],
): Node | undefined {
  for (const segment of path) {
    if (!node) return undefined;
    node =
      node.type === "array"
        ? /^\d+$/.test(segment)
          ? node.children?.[Number(segment)]
          : undefined
        : findNodeAtLocation(node, [segment]);
  }
  return node;
}

function root(text: string): Node {
  const tree = parseTree(text);
  if (!tree || tree.type !== "object") {
    throw new Error("messages: file must be a JSON object");
  }
  return tree;
}

// The keys of each object in a file as written, for addLeaf's `order`:
// read from the text, since a parsed object lists integer-like keys
// ("404") first whatever their place (#654).
export function keyOrder(
  text: string,
): (objectPath: string[]) => string[] | undefined {
  // A blank source reads as an empty object elsewhere; it has no order.
  const tree = parseTree(text);
  if (!tree || tree.type !== "object") return () => undefined;
  const cache = new Map<string, string[] | undefined>();
  return (objectPath) => {
    const id = objectPath.join("\u0000");
    if (cache.has(id)) return cache.get(id);
    const node = objectPath.length ? nodeAt(tree, objectPath) : tree;
    const keys =
      node?.type === "object"
        ? (node.children ?? []).map((p) => String(p.children?.[0]?.value))
        : undefined;
    cache.set(id, keys);
    return keys;
  };
}

function isInline(text: string, node: Node): boolean {
  return !text.slice(node.offset, node.offset + node.length).includes("\n");
}

// Whether keys go into an object on its own line: an inline one, but an
// empty file's `{}`, which a translation fills one key a line, as the
// source writes them (#1041); a nested `{}` stays as the file wrote it.
function writesInline(text: string, node: Node): boolean {
  if (!node.parent && (node.children?.length ?? 0) === 0) return false;
  return isInline(text, node);
}

// The nested object a run of path segments becomes, in the parent's
// style: on one line inside an inline object, expanded otherwise.
function render(
  segments: string[],
  value: string | JsonValue,
  inline: boolean,
  indent: string,
  unit: string,
  eol: string,
): string {
  if (segments.length === 0)
    return typeof value === "string"
      ? JSON.stringify(value)
      : jsonText(value.json, inline, indent, unit, eol);
  const [head, ...rest] = segments;
  const inner = render(rest, value, inline, indent + unit, unit, eol);
  const key = JSON.stringify(head);
  return inline
    ? `{ ${key}: ${inner} }`
    : `{${eol}${indent}${unit}${key}: ${inner}${eol}${indent}}`;
}

// A value that is no string, a list the source holds, written whole
// (#1053).
export type JsonValue = { json: unknown };

// A JSON value in the file's style: on one line in an inline object,
// else one item a line under `indent`.
function jsonText(
  value: unknown,
  inline: boolean,
  indent: string,
  unit: string,
  eol: string,
): string {
  if (!inline && value !== null && typeof value === "object")
    return JSON.stringify(value, null, unit)
      .split("\n")
      .join(eol + indent);
  // One line, built rather than squeezed, so no string's text changes.
  const one = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(one).join(", ")}]`;
    if (v !== null && typeof v === "object") {
      const entries = Object.entries(v);
      return entries.length === 0
        ? "{}"
        : `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${one(x)}`).join(", ")} }`;
    }
    return JSON.stringify(v);
  };
  return one(value);
}

// An item appended to the list at `path`, in its style (#1053).
export function appendItem(
  text: string,
  path: string[],
  value: unknown,
  unit: string,
): string {
  checkPath(path);
  const list = nodeAt(root(text), path);
  if (list?.type !== "array") return text;
  const eol = eolOf(text);
  const items = list.children ?? [];
  const inline = isInline(text, list);
  const last = items[items.length - 1];
  const indent = last
    ? lineIndent(text, last.offset)
    : lineIndent(text, list.offset) + unit;
  const item = jsonText(value, inline, indent, unit, eol);
  if (!last) {
    const open = list.offset + 1;
    const close = list.offset + list.length - 1;
    return inline
      ? text.slice(0, open) + item + text.slice(close)
      : `${text.slice(0, open)}${eol}${indent}${item}${eol}${lineIndent(text, list.offset)}${text.slice(close)}`;
  }
  const at = last.offset + last.length;
  return `${text.slice(0, at)}${inline ? ", " : `,${eol}${indent}`}${item}${text.slice(at)}`;
}

// The list at `path` cut to its first `keep` items, the rest and the
// separators before them gone (#1053).
export function truncateList(
  text: string,
  path: string[],
  keep: number,
): string {
  const list = nodeAt(root(text), path);
  const items = list?.type === "array" ? (list.children ?? []) : [];
  if (keep >= items.length || keep < 1) return text;
  const last = items[keep - 1]!;
  const end = items[items.length - 1]!;
  return (
    text.slice(0, last.offset + last.length) +
    text.slice(end.offset + end.length)
  );
}

// The node's token replaced, whatever it holds.
function replaceNode(text: string, node: Node, value: string): string {
  return (
    text.slice(0, node.offset) +
    JSON.stringify(value) +
    text.slice(node.offset + node.length)
  );
}

// The value token at `path` replaced. Undefined when there is no
// string there.
export function editLeaf(
  text: string,
  path: string[],
  value: string,
): string | undefined {
  checkPath(path);
  const node = nodeAt(root(text), path);
  if (!node || node.type !== "string") return undefined;
  return replaceNode(text, node, value);
}

// The property at `path` removed with its comma and the whitespace
// between it and its neighbour; an object emptied by that is removed
// too, up to the root. Unchanged text when there is no string there.
export function deleteLeaf(text: string, path: string[]): string {
  checkPath(path);
  const node = nodeAt(root(text), path);
  if (!node || node.type !== "string") return text;
  return removeProperty(text, path);
}

// The property at `path` removed whatever it holds, as deleteLeaf
// removes a string: a Chrome i18n entry goes with its description and
// placeholders (#595).
export function deleteKey(text: string, path: string[]): string {
  checkPath(path);
  return nodeAt(root(text), path) ? removeProperty(text, path) : text;
}

function removeProperty(text: string, path: string[]): string {
  const node = nodeAt(root(text), path);
  const property = node?.parent;
  const object = property?.parent;
  if (!property || property.type !== "property" || !object) return text;
  const siblings = object.children ?? [];
  const index = siblings.indexOf(property);
  if (siblings.length === 1) {
    // The last property goes with its object, unless the object is the
    // file itself, which stays as `{}`.
    if (path.length > 1) return removeProperty(text, path.slice(0, -1));
    return (
      text.slice(0, object.offset + 1) +
      text.slice(object.offset + object.length - 1)
    );
  }
  // The comma and whitespace before the property go with it, so a
  // neighbour on the same line keeps its place; the first property
  // takes what follows it instead.
  const start =
    index > 0
      ? siblings[index - 1]!.offset + siblings[index - 1]!.length
      : property.offset;
  const end =
    index > 0 ? property.offset + property.length : siblings[1]!.offset;
  return text.slice(0, start) + text.slice(end);
}

// A string added at `path`: into the deepest object that exists on the
// way, the rest of the path as nested objects in that object's style;
// where a string sits on the way, a flat key at the root instead, set
// rather than duplicated when it exists. A value already at the full
// path is replaced; an object there is a collision. `order` gives the
// source file's keys in an object, so a new key lands beside its
// neighbours there rather than last (#654).
export function addLeaf(
  text: string,
  path: string[],
  value: string | JsonValue,
  unit: string,
  order?: (objectPath: string[]) => string[] | undefined,
): string {
  checkPath(path);
  const tree = root(text);
  let parent: Node = tree;
  let depth = 0;
  for (; depth < path.length - 1; depth++) {
    const next = nodeAt(parent, [path[depth]!]);
    if (!next) break;
    // An object a list holds is a parent like any other (#1053).
    if (next.type !== "object") {
      if (typeof value !== "string") return text;
      return addLeaf(text, [path.join(".")], value, unit, order);
    }
    parent = next;
  }
  const existing =
    depth === path.length - 1 ? nodeAt(parent, [path[depth]!]) : undefined;
  if (existing?.type === "object") {
    throw new Error(
      `messages: id ${JSON.stringify(path.join("."))} collides with a nested key path`,
    );
  }
  if (existing)
    return typeof value === "string"
      ? replaceNode(text, existing, value)
      : text;
  const last = parent.children?.[parent.children.length - 1];
  const eol = eolOf(text);
  const rendered = render(
    path.slice(depth + 1),
    value,
    writesInline(text, parent),
    last
      ? lineIndent(text, last.offset)
      : lineIndent(text, parent.offset) + unit,
    unit,
    eol,
  );
  return insert(
    text,
    parent,
    path[depth]!,
    rendered,
    unit,
    eol,
    order?.(path.slice(0, depth)),
  );
}

function insert(
  text: string,
  object: Node,
  key: string,
  rendered: string,
  unit: string,
  eol: string,
  order?: string[],
): string {
  const entry = `${JSON.stringify(key)}: ${rendered}`;
  const properties = object.children ?? [];
  if (properties.length === 0) {
    // Whatever sat between the braces goes; the entry takes its place.
    const open = object.offset + 1;
    const close = object.offset + object.length - 1;
    const inline = writesInline(text, object);
    const body = inline
      ? ` ${entry} `
      : `${eol}${lineIndent(text, object.offset)}${unit}${entry}${eol}${lineIndent(text, object.offset)}`;
    return text.slice(0, open) + body + text.slice(close);
  }
  const inline = isInline(text, object);
  const separatorBefore = (property: Node) =>
    inline ? ", " : `,${eol}${lineIndent(text, property.offset)}`;
  const neighbour = order && neighbourOf(properties, key, order);
  if (neighbour?.before) {
    const at = neighbour.before.offset;
    return (
      text.slice(0, at) +
      entry +
      separatorBefore(neighbour.before) +
      text.slice(at)
    );
  }
  const after = neighbour?.after ?? properties[properties.length - 1]!;
  const at = after.offset + after.length;
  return text.slice(0, at) + separatorBefore(after) + entry + text.slice(at);
}

// Where a key goes among an object's properties by the source's order:
// after the nearest key before it there that the object has, else
// before the nearest after it; undefined when the source has neither.
function neighbourOf(
  properties: Node[],
  key: string,
  order: string[],
): { after?: Node; before?: Node } | undefined {
  const index = order.indexOf(key);
  if (index < 0) return undefined;
  const byKey = new Map(
    properties.map((property) => [property.children?.[0]?.value, property]),
  );
  for (let i = index - 1; i >= 0; i--) {
    const property = byKey.get(order[i]);
    if (property) return { after: property };
  }
  for (let i = index + 1; i < order.length; i++) {
    const property = byKey.get(order[i]);
    if (property) return { before: property };
  }
  return undefined;
}
