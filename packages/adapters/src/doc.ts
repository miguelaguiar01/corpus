// A JSON file a pull or a proposal edits key by key (#693). The
// sequential document splices each change into the text as it comes,
// one parse each; the batched one parses once, keeps the changes in a
// model of the parse, and splices them all at the next read, writing
// the bytes the sequential one would. Edits go with removals or with
// additions in one batch, never both: a removal next to an addition is
// read after the other is written.
import { parseTree, type Node, type ParseError } from "jsonc-parser";
import {
  addLeaf,
  checkPath,
  collides,
  deleteKey,
  deleteLeaf,
  editLeaf,
} from "./splice";
import { applied, eolOf, lineIndent, type Patch } from "./text";

export type Order = (objectPath: string[]) => string[] | undefined;

export interface JsonDoc {
  // editLeaf: whether a string was there to replace.
  edit(path: string[], value: string): boolean;
  // deleteLeaf, or deleteKey for `whole`: whether anything went.
  remove(path: string[], whole?: boolean): boolean;
  add(path: string[], value: string, unit: string, order?: Order): void;
  // Any other write, on the text as it stands.
  apply(write: (text: string) => string): void;
  text(): string;
}

export function jsonDoc(text: string, sequential = false): JsonDoc {
  return sequential ? new SequentialDoc(text) : new BatchDoc(text);
}

class SequentialDoc implements JsonDoc {
  constructor(private current: string) {}
  edit(path: string[], value: string): boolean {
    const next = editLeaf(this.current, path, value);
    if (next === undefined) return false;
    this.current = next;
    return true;
  }
  remove(path: string[], whole = false): boolean {
    const before = this.current;
    this.current = whole ? deleteKey(before, path) : deleteLeaf(before, path);
    return this.current !== before;
  }
  add(path: string[], value: string, unit: string, order?: Order): void {
    this.current = addLeaf(this.current, path, value, unit, order);
  }
  apply(write: (text: string) => string): void {
    this.current = write(this.current);
  }
  text(): string {
    return this.current;
  }
}

// A property: one the parse holds, with the new ones written right
// before and right after it, or a new one, in the run it sits in.
type Prop = {
  key: string;
  // Its line's indent, a new one's taken from the property it was
  // placed beside, as insert's separator writes it.
  indent?: string;
  node?: Node;
  before?: Prop[];
  after?: Prop[];
  run?: Prop[];
  value?: string | Obj;
};

// An object: one the parse holds, its properties those of the file,
// `items` the new ones of one that had none; or a new one, rendered as
// addLeaf's render() writes it.
type Obj = {
  node?: Node;
  holder?: { obj: Obj; prop: Prop };
  inline?: boolean;
  props: Prop[];
  items: Prop[];
  byKey: Map<string, Prop>;
  live: number;
  duplicates: boolean;
  itemIndent: string;
  closeIndent: string;
  placeable?: boolean;
};

type Place =
  { node: Node; obj?: Obj; prop?: Prop } | { prop: Prop; node?: undefined };

// The answer for a shape the model leaves to the sequential path.
const ASIDE = Symbol("aside");

class BatchDoc implements JsonDoc {
  private tree: Node | undefined;
  private plain = false;
  private eol = "\n";
  private objs = new Map<Node, Obj>();
  private edits = new Map<Node, string>();
  private touched = new Set<Obj>();
  private removed = new Set<Node>();
  private emptied = new Set<Obj>();
  private mode: "none" | "remove" | "add" = "none";
  private positions = new WeakMap<string[], Map<string, number> | null>();

  constructor(private current: string) {}

  text(): string {
    if (this.edits.size > 0 || this.touched.size > 0 || this.emptied.size > 0)
      this.current = this.render();
    this.reset();
    return this.current;
  }

  apply(write: (text: string) => string): void {
    this.current = write(this.text());
  }

  private pending(): boolean {
    return (
      this.edits.size > 0 ||
      this.touched.size > 0 ||
      this.emptied.size > 0 ||
      this.removed.size > 0
    );
  }

  edit(path: string[], value: string): boolean {
    checkPath(path);
    if (!this.ready()) return this.aside((d) => d.edit(path, value));
    const at = this.resolve(path);
    if (at === ASIDE) return this.aside((d) => d.edit(path, value));
    if (!at) return false;
    if (at.node) {
      if (at.node.type !== "string") return false;
      this.edits.set(at.node, value);
      return true;
    }
    if (typeof at.prop.value !== "string") return false;
    at.prop.value = value;
    return true;
  }

  remove(path: string[], whole = false): boolean {
    checkPath(path);
    if (!this.ready()) return this.aside((d) => d.remove(path, whole));
    const at = this.resolve(path);
    if (at === ASIDE || (at && !at.node))
      return this.aside((d) => d.remove(path, whole));
    if (!at || (!whole && at.node.type !== "string")) return false;
    if (!at.obj || !at.prop) return false;
    // Pending additions are written first, only when something goes.
    if (this.mode === "add") {
      this.text();
      return this.remove(path, whole);
    }
    this.mode = "remove";
    this.drop(at.obj, at.prop);
    return true;
  }

  add(path: string[], value: string, unit: string, order?: Order): void {
    checkPath(path);
    if (this.mode === "remove") this.text();
    const aside = () => this.aside((d) => d.add(path, value, unit, order));
    if (!this.ready()) return aside();
    let obj = this.objOf(this.tree!);
    let depth = 0;
    for (; depth < path.length - 1; depth++) {
      if (obj.duplicates) return aside();
      const next = obj.byKey.get(path[depth]!);
      if (!next) break;
      const inner = next.node ? valueOf(next.node) : undefined;
      if (inner?.type === "object") obj = this.objOf(inner, obj, next);
      else if (inner?.type === "array") {
        // A list's object item by its index, as resolve walks it (#1290).
        const index = path[depth + 1];
        const item =
          index !== undefined &&
          /^\d+$/.test(index) &&
          depth + 1 < path.length - 1
            ? inner.children?.[Number(index)]
            : undefined;
        if (item?.type !== "object") return aside();
        obj = this.objOf(item);
        depth++;
      } else if (next.value !== undefined && typeof next.value !== "string")
        obj = next.value;
      // A string on the way: a flat key at the root, as addLeaf does.
      else return this.add([path.join(".")], value, unit, order);
    }
    if (obj.duplicates) return aside();
    const key = path[depth]!;
    const existing = depth === path.length - 1 ? obj.byKey.get(key) : undefined;
    if (existing) {
      const inner = existing.node ? valueOf(existing.node) : undefined;
      if (inner?.type === "object" || typeof existing.value === "object")
        collides(path);
      if (inner?.type === "string") this.edits.set(inner, value);
      else if (typeof existing.value === "string") existing.value = value;
      else return aside();
      return;
    }
    if (obj.node && !this.placeable(obj)) return aside();
    // The indent insert reads is a line's, which a pending write before
    // it on that line, another object's close, would change: written
    // first, as the sequential document reads it.
    const last = lastOf(obj);
    const reads = last ? last.node?.offset : obj.node?.offset;
    if (reads !== undefined && this.pending()) {
      const start = this.current.lastIndexOf("\n", reads - 1) + 1;
      if (this.current.slice(start, reads).trim() !== "") {
        this.text();
        return this.add(path, value, unit, order);
      }
    }
    this.mode = "add";
    this.insert(
      obj,
      key,
      path.slice(depth + 1),
      value,
      unit,
      order?.(path.slice(0, depth)),
    );
  }

  // The file parsed, unless it is no plain JSON object the model reads
  // as the splice does: then each change goes the sequential way.
  private ready(): boolean {
    if (this.plain) return false;
    if (this.tree) return true;
    const errors: ParseError[] = [];
    const tree = parseTree(this.current, errors);
    if (!tree || tree.type !== "object") {
      throw new Error("messages: file must be a JSON object");
    }
    // A BOM is kept in the text, and reported as the one error at 0.
    const bom = this.current.startsWith("\uFEFF");
    if (errors.some((e) => !(bom && e.offset === 0 && e.length === 1))) {
      this.plain = true;
      return false;
    }
    this.tree = tree;
    this.eol = eolOf(this.current);
    return true;
  }

  private reset(): void {
    this.tree = undefined;
    this.plain = false;
    this.objs.clear();
    this.edits.clear();
    this.touched.clear();
    this.removed.clear();
    this.emptied.clear();
    this.mode = "none";
  }

  // A change the model does not hold, made on the text as it stands.
  private aside<T>(change: (doc: SequentialDoc) => T): T {
    const plain = this.plain;
    const doc = new SequentialDoc(this.text());
    const result = change(doc);
    this.current = doc.text();
    this.plain = plain;
    return result;
  }

  private objOf(node: Node, parent?: Obj, prop?: Prop): Obj {
    let obj = this.objs.get(node);
    if (obj) return obj;
    const props: Prop[] = [];
    const byKey = new Map<string, Prop>();
    let duplicates = false;
    for (const child of node.children ?? []) {
      const key = String(child.children?.[0]?.value);
      const p: Prop = {
        key,
        node: child,
        before: [],
        after: [],
      };
      props.push(p);
      if (byKey.has(key)) duplicates = true;
      else byKey.set(key, p);
    }
    obj = {
      node,
      ...(parent && prop && { holder: { obj: parent, prop } }),
      props,
      items: [],
      byKey,
      live: props.length,
      duplicates,
      itemIndent: "",
      closeIndent: "",
    };
    this.objs.set(node, obj);
    return obj;
  }

  // nodeAt's walk, through the new properties too.
  private resolve(path: string[]): Place | undefined | typeof ASIDE {
    let at: Place = { node: this.tree! };
    for (const segment of path) {
      if (at.node?.type === "array") {
        if (!/^\d+$/.test(segment)) return undefined;
        const item: Node | undefined = at.node.children?.[Number(segment)];
        if (!item) return undefined;
        at = { node: item };
        continue;
      }
      let obj: Obj;
      if (at.node) {
        if (at.node.type !== "object") return undefined;
        obj = this.objOf(at.node, at.obj, at.prop);
      } else if (at.prop.value && typeof at.prop.value === "object")
        obj = at.prop.value;
      else return undefined;
      if (obj.duplicates) return ASIDE;
      const prop = obj.byKey.get(segment);
      if (!prop) return undefined;
      if (!prop.node) {
        at = { prop };
        continue;
      }
      const value = valueOf(prop.node);
      if (!value) return undefined;
      at = { node: value, obj, prop };
    }
    return at;
  }

  // removeProperty: a property gone, and an object it empties with it,
  // but the file and a list's item, which stay as `{}`.
  private drop(obj: Obj, prop: Prop): void {
    this.removed.add(prop.node!);
    if (obj.byKey.get(prop.key) === prop) obj.byKey.delete(prop.key);
    obj.live -= 1;
    this.touched.add(obj);
    if (obj.live > 0) return;
    // Only an object a property holds has a holder.
    if (obj.holder) this.drop(obj.holder.obj, obj.holder.prop);
    else this.emptied.add(obj);
  }

  private indentOf(prop: Prop): string {
    return (prop.indent ??= lineIndent(this.current, prop.node!.offset));
  }

  private inlineOf(obj: Obj): boolean {
    if (obj.inline === undefined) {
      const node = obj.node!;
      const eol = this.current.indexOf("\n", node.offset);
      obj.inline = eol < 0 || eol >= node.offset + node.length;
    }
    return obj.inline;
  }

  // A property placed only where every one of the object's starts its
  // line, or the object is on one: a new line elsewhere would move a
  // property after it to another line's indent.
  private placeable(obj: Obj): boolean {
    if (this.inlineOf(obj) || obj.props.length === 0) return true;
    obj.placeable ??= obj.props.every((p) => {
      const start = this.current.lastIndexOf("\n", p.node!.offset - 1) + 1;
      return p.node!.offset - start === this.indentOf(p).length;
    });
    return obj.placeable;
  }

  // insert, on the model: beside the source's neighbour, else last.
  private insert(
    obj: Obj,
    key: string,
    rest: string[],
    value: string,
    unit: string,
    order: string[] | undefined,
  ): void {
    if (obj.node) this.touched.add(obj);
    const last = lastOf(obj);
    // The root's `{}` is filled a key a line (#1041).
    const inline =
      obj.node && !obj.node.parent && obj.props.length === 0
        ? false
        : this.inlineOf(obj);
    // On one line no indent is written: none is read, which in a
    // minified file would scan it whole for each key.
    const indent = inline
      ? ""
      : last
        ? this.indentOf(last)
        : lineIndent(this.current, obj.node!.offset) + unit;
    const prop: Prop = {
      key,
      indent,
      value: virtual(rest, value, inline, indent, unit),
    };
    if (!last) {
      obj.itemIndent = indent;
      obj.closeIndent = inline
        ? ""
        : lineIndent(this.current, obj.node!.offset);
      prop.run = obj.items;
      obj.items.push(prop);
      obj.byKey.set(key, prop);
      return;
    }
    const neighbour = order && this.neighbourOf(obj, key, order);
    obj.byKey.set(key, prop);
    const anchor = neighbour?.before ?? neighbour?.after ?? last;
    const before = neighbour?.before !== undefined;
    prop.indent = inline ? "" : this.indentOf(anchor);
    if (anchor.node) {
      prop.run = before ? anchor.before! : anchor.after!;
      if (before) prop.run.push(prop);
      else prop.run.unshift(prop);
      return;
    }
    const run = anchor.run!;
    prop.run = run;
    const i = run.lastIndexOf(anchor);
    run.splice(before ? i : i + 1, 0, prop);
  }

  private neighbourOf(
    obj: Obj,
    key: string,
    order: string[],
  ): { after?: Prop; before?: Prop } | undefined {
    // An order seen once is searched; one seen again is indexed, as
    // writeSuffix's are new for each family.
    let positions = this.positions.get(order);
    if (positions === null) {
      positions = new Map();
      for (const [i, k] of order.entries())
        if (!positions.has(k)) positions.set(k, i);
      this.positions.set(order, positions);
    } else if (positions === undefined) this.positions.set(order, null);
    const found = positions ? positions.get(key) : order.indexOf(key);
    const index = found === undefined || found < 0 ? undefined : found;
    if (index === undefined) return undefined;
    for (let i = index - 1; i >= 0; i--) {
      const prop = obj.byKey.get(order[i]!);
      if (prop) return { after: prop };
    }
    for (let i = index + 1; i < order.length; i++) {
      const prop = obj.byKey.get(order[i]!);
      if (prop) return { before: prop };
    }
    return undefined;
  }

  private render(): string {
    const patches: Patch[] = [];
    const dead = (node: Node): boolean => {
      for (let at: Node | undefined = node; at; at = at.parent) {
        if (this.removed.has(at)) return true;
        const obj = this.objs.get(at);
        if (obj && obj !== this.objs.get(node) && this.emptied.has(obj))
          return true;
      }
      return false;
    };
    for (const [node, value] of this.edits)
      if (!dead(node))
        patches.push({
          start: node.offset,
          end: node.offset + node.length,
          text: JSON.stringify(value),
        });
    for (const obj of this.touched) {
      const node = obj.node!;
      if (dead(node)) continue;
      if (
        this.emptied.has(obj) ||
        (obj.props.length === 0 && obj.items.length > 0)
      ) {
        patches.push({
          start: node.offset + 1,
          end: node.offset + node.length - 1,
          text: this.emptied.has(obj) ? "" : this.body(obj),
        });
        continue;
      }
      if (obj.live === 0) continue;
      if (this.mode === "remove") this.removals(obj, patches);
      else this.additions(obj, patches);
    }
    patches.sort((a, b) => a.start - b.start);
    for (let i = 1; i < patches.length; i++)
      if (patches[i]!.start < patches[i - 1]!.end)
        throw new Error("messages: overlapping splices");
    return applied(this.current, patches);
  }

  // The removed properties' bytes, as removeProperty cuts them one at a
  // time: a property and the separator before it, the first one and the
  // separator after it.
  private removals(obj: Obj, patches: Patch[]): void {
    const props = obj.props;
    const gone = (i: number) => this.removed.has(props[i]!.node!);
    const end = (p: Prop) => p.node!.offset + p.node!.length;
    let kept = -1;
    for (let i = 0; i < props.length; i++) {
      if (gone(i)) continue;
      if (kept < 0 && i > 0)
        patches.push({
          start: props[0]!.node!.offset,
          end: props[i]!.node!.offset,
          text: "",
        });
      else if (kept >= 0 && i > kept + 1)
        patches.push({
          start: end(props[kept]!),
          end: end(props[i - 1]!),
          text: "",
        });
      kept = i;
    }
    if (kept < props.length - 1)
      patches.push({
        start: end(props[kept]!),
        end: end(props[props.length - 1]!),
        text: "",
      });
  }

  private additions(obj: Obj, patches: Patch[]): void {
    for (const prop of obj.props) {
      const node = prop.node!;
      const sep = this.inlineOf(obj)
        ? ", "
        : `,${this.eol}${this.indentOf(prop)}`;
      if (prop.before!.length > 0)
        patches.push({
          start: node.offset,
          end: node.offset,
          text: prop.before!.map((p) => this.entry(p) + sep).join(""),
        });
      if (prop.after!.length > 0)
        patches.push({
          start: node.offset + node.length,
          end: node.offset + node.length,
          text: prop.after!.map((p) => sep + this.entry(p)).join(""),
        });
    }
  }

  // What sits between the braces of an object that had no properties.
  private body(obj: Obj): string {
    const inline = obj.node!.parent ? this.inlineOf(obj) : false;
    const items = obj.items.map((p) => this.entry(p));
    return inline
      ? ` ${items.join(", ")} `
      : `${this.eol}${obj.itemIndent}${items.join(`,${this.eol}${obj.itemIndent}`)}${this.eol}${obj.closeIndent}`;
  }

  private entry(prop: Prop): string {
    const value = prop.value!;
    if (typeof value === "string")
      return `${JSON.stringify(prop.key)}: ${JSON.stringify(value)}`;
    const items = value.items.map((p) => this.entry(p));
    return `${JSON.stringify(prop.key)}: ${
      value.inline
        ? `{ ${items.join(", ")} }`
        : `{${this.eol}${value.itemIndent}${items.join(`,${this.eol}${value.itemIndent}`)}${this.eol}${value.closeIndent}}`
    }`;
  }
}

function valueOf(property: Node): Node | undefined {
  return property.children?.length === 2 ? property.children[1] : undefined;
}

// The last property in the text, where a key without a neighbour goes.
function lastOf(obj: Obj): Prop | undefined {
  const last = obj.props[obj.props.length - 1];
  if (!last) return obj.items[obj.items.length - 1];
  return last.after![last.after!.length - 1] ?? last;
}

// render(): the rest of a path as new objects, each a key a line under
// the one before, or on one line in an inline object.
function virtual(
  segments: string[],
  value: string,
  inline: boolean,
  indent: string,
  unit: string,
): string | Obj {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  const inner = indent + unit;
  const items: Prop[] = [];
  const prop: Prop = {
    key: head!,
    indent: inner,
    run: items,
    value: virtual(rest, value, inline, inner, unit),
  };
  items.push(prop);
  return {
    inline,
    props: [],
    items,
    byKey: new Map([[head!, prop]]),
    live: 1,
    duplicates: false,
    itemIndent: inner,
    closeIndent: indent,
  };
}
