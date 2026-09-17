// Byte-precise edits to a JSON object file (§8): a value replaced, a
// property removed, a property added, and every other byte kept, so a
// pull or a proposal reads as the lines it changes. jsonc-parser gives
// the node offsets; the text is spliced here.
import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser";

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

function root(text: string): Node {
  const tree = parseTree(text);
  if (!tree || tree.type !== "object") {
    throw new Error("messages: file must be a JSON object");
  }
  return tree;
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function isInline(text: string, node: Node): boolean {
  return !text.slice(node.offset, node.offset + node.length).includes("\n");
}

// The leading whitespace of the line a node starts on.
function indentOf(text: string, node: Node): string {
  const lineStart = text.lastIndexOf("\n", node.offset) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, node.offset))?.[0] ?? "";
}

// The nested object a run of path segments becomes, in the parent's
// style: on one line inside an inline object, expanded otherwise.
function render(
  segments: string[],
  value: string,
  inline: boolean,
  indent: string,
  unit: string,
  eol: string,
): string {
  if (segments.length === 0) return JSON.stringify(value);
  const [head, ...rest] = segments;
  const inner = render(rest, value, inline, indent + unit, unit, eol);
  const key = JSON.stringify(head);
  return inline
    ? `{ ${key}: ${inner} }`
    : `{${eol}${indent}${unit}${key}: ${inner}${eol}${indent}}`;
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
  const node = findNodeAtLocation(root(text), path);
  if (!node || node.type !== "string") return undefined;
  return replaceNode(text, node, value);
}

// The property at `path` removed with its comma and the whitespace
// between it and its neighbour; an object emptied by that is removed
// too, up to the root. Unchanged text when there is no string there.
export function deleteLeaf(text: string, path: string[]): string {
  checkPath(path);
  const node = findNodeAtLocation(root(text), path);
  if (!node || node.type !== "string") return text;
  return removeProperty(text, path);
}

function removeProperty(text: string, path: string[]): string {
  const node = findNodeAtLocation(root(text), path);
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
// path is replaced; an object there is a collision.
export function addLeaf(
  text: string,
  path: string[],
  value: string,
  unit: string,
): string {
  checkPath(path);
  const tree = root(text);
  let parent: Node = tree;
  let depth = 0;
  for (; depth < path.length - 1; depth++) {
    const next = findNodeAtLocation(parent, [path[depth]!]);
    if (!next) break;
    if (next.type !== "object") {
      return addLeaf(text, [path.join(".")], value, unit);
    }
    parent = next;
  }
  const existing =
    depth === path.length - 1
      ? findNodeAtLocation(parent, [path[depth]!])
      : undefined;
  if (existing?.type === "object") {
    throw new Error(
      `messages: id ${JSON.stringify(path.join("."))} collides with a nested key path`,
    );
  }
  if (existing) return replaceNode(text, existing, value);
  const last = parent.children?.[parent.children.length - 1];
  const eol = eolOf(text);
  const rendered = render(
    path.slice(depth + 1),
    value,
    isInline(text, parent),
    last ? indentOf(text, last) : indentOf(text, parent) + unit,
    unit,
    eol,
  );
  return insert(text, parent, path[depth]!, rendered, unit, eol);
}

function insert(
  text: string,
  object: Node,
  key: string,
  rendered: string,
  unit: string,
  eol: string,
): string {
  const entry = `${JSON.stringify(key)}: ${rendered}`;
  const properties = object.children ?? [];
  if (properties.length === 0) {
    // Whatever sat between the braces goes; the entry takes its place.
    const open = object.offset + 1;
    const close = object.offset + object.length - 1;
    const inline = isInline(text, object);
    const body = inline
      ? ` ${entry} `
      : `${eol}${indentOf(text, object)}${unit}${entry}${eol}${indentOf(text, object)}`;
    return text.slice(0, open) + body + text.slice(close);
  }
  const last = properties[properties.length - 1]!;
  const at = last.offset + last.length;
  const separator = isInline(text, object)
    ? ", "
    : `,${eol}${indentOf(text, last)}`;
  return text.slice(0, at) + separator + entry + text.slice(at);
}
