import { expect, test } from "vitest";
import { jsonDoc, type JsonDoc } from "./doc";
import { keyOrder } from "./splice";

// The batched document against the sequential one (#693), on layouts
// no formatter writes: uneven indents, properties sharing a line,
// lists of objects, repeated keys, and every kind of change in any
// order, read back at random points.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ["a", "b", "c", "10", "404", "x y", "é"];

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

type Value = string | number | null | Value[] | { [key: string]: Value };

function value(r: () => number, depth: number): Value {
  const roll = r();
  if (depth > 0 && roll < 0.35) {
    const out: { [key: string]: Value } = {};
    const n = Math.floor(r() * 4);
    for (let i = 0; i < n; i++) out[pick(r, KEYS)] = value(r, depth - 1);
    return out;
  }
  if (depth > 0 && roll < 0.45)
    return Array.from({ length: Math.floor(r() * 3) }, () =>
      value(r, depth - 1),
    );
  if (roll < 0.5) return 7;
  if (roll < 0.53) return null;
  return `v${Math.floor(r() * 100)}`;
}

// JSON with uneven whitespace: each object inline or not, each
// property on its own line or not, its own indent, a repeated key now
// and then.
function layout(
  r: () => number,
  v: Value,
  indent: string,
  eol: string,
): string {
  if (typeof v !== "object" || v === null) return JSON.stringify(v);
  const pad = () => pick(r, ["", " ", "  ", "\t", "   "]);
  if (Array.isArray(v)) {
    if (v.length === 0) return pick(r, ["[]", "[ ]", `[${eol}${indent}]`]);
    return `[${v.map((x) => `${eol}${indent}${pad()}${layout(r, x, indent + "  ", eol)}`).join(",")}${eol}${indent}]`;
  }
  const entries = Object.entries(v);
  if (r() < 0.1 && entries.length > 0) entries.push(entries[0]!);
  if (entries.length === 0) return pick(r, ["{}", "{ }", `{${eol}${indent}}`]);
  if (r() < 0.25)
    return `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${layout(r, x, indent, eol)}`).join(", ")} }`;
  const inner = indent + pick(r, ["  ", "    ", "\t"]);
  const parts = entries.map(([k, x], i) => {
    const sameLine = i > 0 && r() < 0.15;
    const at = sameLine ? " " : `${eol}${r() < 0.2 ? inner + pad() : inner}`;
    return `${at}${JSON.stringify(k)}: ${layout(r, x, inner, eol)}`;
  });
  return `{${parts.join(",")}${eol}${indent}}`;
}

function paths(v: Value, at: string[] = [], out: string[][] = []) {
  out.push(at);
  if (Array.isArray(v)) v.forEach((x, i) => paths(x, [...at, String(i)], out));
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) paths(x, [...at, k], out);
  return out;
}

type Step = (doc: JsonDoc) => unknown;

function steps(
  r: () => number,
  tree: Value,
  order: ReturnType<typeof keyOrder>,
) {
  const known = paths(tree).filter((p) => p.length > 0);
  const path = (): string[] => {
    if (known.length > 0 && r() < 0.6) {
      const p = pick(r, known);
      return r() < 0.3 ? [...p, pick(r, KEYS)] : p;
    }
    return Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, KEYS));
  };
  const out: [string, Step][] = [];
  const n = 1 + Math.floor(r() * 14);
  for (let i = 0; i < n; i++) {
    const p = path();
    const roll = r();
    const text = `t${i}`;
    const unit = pick(r, ["  ", "\t"]);
    if (roll < 0.3) out.push([`edit ${p}`, (d) => d.edit(p, text)]);
    else if (roll < 0.5) {
      const whole = r() < 0.4;
      out.push([`remove ${p} ${whole}`, (d) => d.remove(p, whole)]);
    } else if (roll < 0.9) {
      const ordered = r() < 0.6;
      out.push([
        `add ${p}`,
        (d) => d.add(p, text, unit, ordered ? order : undefined),
      ]);
    } else if (roll < 0.95) out.push(["read", (d) => d.text()]);
    else out.push(["apply", (d) => d.apply((t) => t.replace(/"v1/, '"w1'))]);
  }
  return out;
}

test("a batched document's changes give the sequential one's bytes, on any layout (#693)", () => {
  for (let seed = 1; seed <= 6000; seed++) {
    const r = rng(seed);
    const eol = r() < 0.3 ? "\r\n" : "\n";
    const root = value(r, 3);
    const tree =
      root !== null && typeof root === "object" && !Array.isArray(root)
        ? root
        : { a: root };
    const text =
      (r() < 0.1 ? "﻿" : "") +
      (r() < 0.1 ? pick(r, ["{}", `{${eol}}`]) : layout(r, tree, "", eol)) +
      eol;
    const source = layout(r, value(r, 3) ?? {}, "", eol);
    const order = keyOrder(
      source.startsWith("{") ? source : JSON.stringify({ a: 1, b: 2, c: 3 }),
    );
    const plan = steps(r, tree, order);
    const run = (sequential: boolean) => {
      const doc = jsonDoc(text, sequential);
      const answers: unknown[] = [];
      try {
        for (const [, step] of plan) answers.push(step(doc));
        return [doc.text(), answers];
      } catch (error) {
        return [`throws: ${(error as Error).message}`, answers];
      }
    };
    expect(
      run(false),
      `seed ${seed}: ${plan.map(([name]) => name).join("; ")}`,
    ).toEqual(run(true));
  }
});
