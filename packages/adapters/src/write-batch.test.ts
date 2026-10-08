import { expect, test } from "vitest";
import { applyMessagesOps, entriesToMessages, type SourceOp } from "./write";
import { appendItem, appendItems } from "./splice";

// A pull's edits, additions and removals are spliced from one parse per
// phase (#693): the result is held, byte for byte, to the sequential
// path, which writes one key at a time and stays as the oracle.

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

type Tree = { [key: string]: string | Tree | string[] };

const KEYS = ["a", "b", "c", "d", "e", "404", "10", "x y", "é", "z"];

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

function generate(
  r: () => number,
  depth: number,
  plurals: boolean,
  suffix: boolean,
): Tree {
  const out: Tree = {};
  const n = 1 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const key = pick(r, KEYS) + (r() < 0.5 ? String(i) : "");
    const roll = r();
    if (depth > 0 && roll < 0.3)
      out[key] = generate(r, depth - 1, plurals, suffix);
    else if (roll < 0.35) out[key] = {};
    else if (roll < 0.4) out[key] = ["one", "two"];
    else if (plurals && roll < 0.5)
      out[key] = { one: `${key} one`, other: `${key} other` };
    else if (suffix && roll < 0.55) {
      out[`${key}_one`] = `${key} one`;
      out[`${key}_other`] = `${key} others`;
    } else out[key] = `Text ${key} ${i}`;
  }
  return out;
}

// The file as a person might write it: indent, line ends, a BOM, and
// some objects on one line.
function write(
  r: () => number,
  tree: Tree,
  style: { unit: string; eol: string; bom: boolean; inline: number },
): string {
  const render = (value: Tree | string | string[], indent: string): string => {
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) return JSON.stringify(value);
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    if (indent !== "" && r() < style.inline)
      return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${render(v, indent + style.unit)}`).join(", ")} }`;
    const inner = indent + style.unit;
    return `{${style.eol}${entries
      .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${render(v, inner)}`)
      .join(`,${style.eol}`)}${style.eol}${indent}}`;
  };
  return (style.bom ? "\uFEFF" : "") + render(tree, "") + style.eol;
}

function leafIds(tree: Tree, path: string[] = [], out: string[] = []) {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.push([...path, key].join("."));
    else if (!Array.isArray(value)) leafIds(value, [...path, key], out);
  }
  return out;
}

// A target derived from the source: keys dropped, values changed, keys
// the source lacks, an empty object, or nothing at all.
function derive(r: () => number, tree: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    const roll = r();
    if (roll < 0.25) continue;
    if (typeof value === "string")
      out[key] = roll < 0.5 ? `Alt ${value}` : value;
    else if (Array.isArray(value)) out[key] = value;
    else {
      out[key] = derive(r, value);
      // A target's plural object may hold a form its source lacks.
      if ("one" in value && "other" in value && r() < 0.3)
        (out[key] as Tree).few = `${key} few`;
    }
  }
  if (r() < 0.2) out[`extra${Math.floor(r() * 9)}`] = "Extra";
  return out;
}

// A plural of a random set of forms, so a pull adds and removes them
// (#1265), sometimes one its object cannot hold.
function pluralOf(r: () => number): string {
  if (r() < 0.1)
    return "{count, plural, =0 {nada} one {# um} other {# muitos}}";
  const forms = ["zero", "one", "two", "few", "many", "other"].filter(
    () => r() < 0.5,
  );
  if (forms.length === 0) forms.push("other");
  return `{count, plural, ${forms.map((f) => `${f} {# ${f}}`).join(" ")}}`;
}

function translationsFor(r: () => number, ids: string[], nested: boolean) {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const roll = r();
    if (roll < 0.4) continue;
    out[id] = roll < 0.5 ? pluralOf(r) : `Tradução ${id}`;
  }
  // Ids the source lacks, flat and under groups that may not exist.
  const extra = Math.floor(r() * 4);
  for (let i = 0; i < extra; i++) {
    const id = nested
      ? `${pick(r, KEYS)}.${pick(r, KEYS)}${i}`
      : `${pick(r, KEYS)}new${i}`;
    out[id] = `Nova ${i}`;
  }
  return out;
}

function both(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  options: Parameters<typeof entriesToMessages>[3],
) {
  const run = (sequential: boolean) => {
    try {
      return entriesToMessages(template, translations, existing, {
        ...options,
        sequential,
      });
    } catch (error) {
      return `throws: ${(error as Error).message}`;
    }
  };
  return [run(false), run(true)] as const;
}

test("a batched pull writes what the sequential one does, byte for byte, over generated files (#693)", () => {
  let compared = 0;
  for (let seed = 1; seed <= 2500; seed++) {
    const r = rng(seed);
    const plurals = r() < 0.3;
    const suffix = !plurals && r() < 0.3;
    const source = generate(r, Math.floor(r() * 3), plurals, suffix);
    const style = {
      unit: pick(r, ["  ", "    ", "\t"]),
      eol: r() < 0.3 ? "\r\n" : "\n",
      bom: r() < 0.15,
      inline: r() < 0.3 ? 0.5 : 0,
    };
    const template = write(r, source, style);
    const roll = r();
    const existing =
      roll < 0.15
        ? undefined
        : roll < 0.25
          ? `{}${style.eol}`
          : write(r, derive(r, source), style);
    const nested = Object.values(source).some(
      (v) => typeof v === "object" && !Array.isArray(v),
    );
    const translations = translationsFor(r, leafIds(source), nested);
    const options = {
      ...(plurals && { plurals: "several" as const }),
      ...(suffix && { suffixPlurals: true, sourceLanguage: "en" }),
    };
    const [batched, sequential] = both(
      template,
      translations,
      existing,
      options,
    );
    expect(batched, `seed ${seed}`).toBe(sequential);
    compared += 1;
  }
  expect(compared).toBe(2500);
});

test("batched proposals write what sequential ones do, byte for byte, over generated files (#693)", () => {
  for (let seed = 1; seed <= 2500; seed++) {
    const r = rng(seed * 7919);
    const plurals = r() < 0.3;
    const suffix = !plurals && r() < 0.3;
    const style = {
      unit: pick(r, ["  ", "    ", "\t"]),
      eol: r() < 0.3 ? "\r\n" : "\n",
      bom: r() < 0.15,
      inline: r() < 0.3 ? 0.5 : 0,
    };
    const tree = generate(r, Math.floor(r() * 3), plurals, suffix);
    const text = r() < 0.1 ? `{}${style.eol}` : write(r, tree, style);
    const ids = leafIds(tree);
    const ops: SourceOp[] = [];
    const count = Math.floor(r() * 12);
    for (let i = 0; i < count; i++) {
      const id =
        ids.length > 0 && r() < 0.6
          ? pick(r, ids)
          : r() < 0.5
            ? `${pick(r, KEYS)}.${pick(r, KEYS)}${i}`
            : `${pick(r, KEYS)}new${i}`;
      const roll = r();
      ops.push(
        roll < 0.3
          ? { kind: "delete", id }
          : {
              kind: roll < 0.65 ? "edit" : "add",
              id,
              text:
                r() < 0.15
                  ? "{n, plural, one {# um} other {# muitos}}"
                  : r() < 0.2
                    ? pluralOf(r)
                    : `Proposta ${i}`,
            },
      );
    }
    const options = {
      ...(plurals && { plurals: "several" as const }),
      ...(suffix && { suffixPlurals: true, sourceLanguage: "en" }),
      ...(r() < 0.2 && { chrome: true }),
    };
    const run = (sequential: boolean) => {
      try {
        return applyMessagesOps(text, ops, { ...options, sequential });
      } catch (error) {
        return `throws: ${(error as Error).message}`;
      }
    };
    expect(run(false), `seed ${seed}`).toBe(run(true));
  }
});

test("a batched Chrome or entry pull writes what the sequential one does (#693)", () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const r = rng(seed * 104729);
    const eol = r() < 0.3 ? "\r\n" : "\n";
    const ids = Array.from(
      { length: 1 + Math.floor(r() * 8) },
      (_, i) => `${pick(r, KEYS)}${i}`,
    );
    const entry = (id: string, text: string) =>
      r() < 0.3
        ? { message: text, description: `About ${id}` }
        : { message: text };
    const source = Object.fromEntries(
      ids.map((id) => [id, entry(id, `Text ${id}`)]),
    );
    const target = Object.fromEntries(
      ids.filter(() => r() < 0.6).map((id) => [id, entry(id, `Alt ${id}`)]),
    );
    const json = (value: unknown) =>
      JSON.stringify(value, null, pick(r, ["  ", "\t"]))
        .split("\n")
        .join(eol) + eol;
    const template = json(source);
    const existing = r() < 0.2 ? undefined : json(target);
    const translations: Record<string, string> = {};
    for (const id of ids) if (r() < 0.6) translations[id] = `Tradução ${id}`;
    if (r() < 0.3) translations[`extra${seed % 5}`] = "Extra";
    const kind =
      r() < 0.5 ? { chrome: true } : { entries: { text: "message" } };
    const run = (sequential: boolean) => {
      try {
        return entriesToMessages(template, translations, existing, {
          ...kind,
          sequential,
        });
      } catch (error) {
        return `throws: ${(error as Error).message}`;
      }
    };
    expect(run(false), `seed ${seed}`).toBe(run(true));
  }
});

test("a large pull's edits, additions and first fill each take one parse per phase, not one per key (#693)", () => {
  const file = (n: number, value = (i: number) => `Text ${i}`) =>
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`k${i}`, value(i)]),
      ),
      null,
      2,
    ) + "\n";
  const all = (n: number, value: (i: number) => string) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`k${i}`, value(i)]),
    );
  const nestedOf = (groups: number, keys: number, value: string) =>
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: groups }, (_, g) => [
          `g${g}`,
          Object.fromEntries(
            Array.from({ length: keys }, (_, i) => [`k${i}`, value]),
          ),
        ]),
      ),
      null,
      2,
    ) + "\n";
  const nestedAll: Record<string, string> = {};
  for (let g = 0; g < 50; g++)
    for (let i = 0; i < 100; i++) nestedAll[`g${g}.k${i}`] = "B";
  const cases: [string, () => string][] = [
    [
      "add 2500 to 2500",
      () =>
        entriesToMessages(
          file(5000),
          all(5000, (i) => `Alt ${i}`),
          file(2500, (i) => `Alt ${i}`),
        ),
    ],
    [
      "edit 2500 of 5000",
      () =>
        entriesToMessages(
          file(5000),
          all(2500, (i) => `New ${i}`),
          file(5000),
        ),
    ],
    [
      "add 5000 to 5000",
      () =>
        entriesToMessages(
          file(10000),
          all(10000, (i) => `Alt ${i}`),
          file(5000, (i) => `Alt ${i}`),
        ),
    ],
    [
      "edit 5000 of 10000",
      () =>
        entriesToMessages(
          file(10000),
          all(5000, (i) => `New ${i}`),
          file(10000),
        ),
    ],
    [
      "first pull into {} of 5000",
      () =>
        entriesToMessages(
          file(5000),
          all(5000, (i) => `Alt ${i}`),
          "{}\n",
        ),
    ],
    [
      "a new file, 500 of 5000 translated",
      () =>
        entriesToMessages(
          file(5000),
          all(500, (i) => `Alt ${i}`),
          undefined,
        ),
    ],
    [
      "nested, add 2500 to 2500 and edit 2500",
      () =>
        entriesToMessages(
          nestedOf(50, 100, "T"),
          nestedAll,
          nestedOf(50, 50, "A"),
        ),
    ],
  ];
  // A BOM is kept in the text, and the parser reports it.
  cases.push([
    "add 2500 to 2500, a BOM",
    () =>
      entriesToMessages(
        "\uFEFF" + file(5000),
        all(5000, (i) => `Alt ${i}`),
        "\uFEFF" + file(2500, (i) => `Alt ${i}`),
      ),
  ]);
  // i18next families written afresh: the forms the text lacks are
  // removed between the forms it adds.
  const families = Object.fromEntries(
    Array.from({ length: 1500 }, (_, i) => [
      [`k${i}_one`, `One ${i}`],
      [`k${i}_other`, `Other ${i}`],
    ]).flat(),
  );
  cases.push([
    "a fresh pull of 1500 Russian families",
    () =>
      entriesToMessages(
        JSON.stringify(families, null, 2) + "\n",
        Object.fromEntries(
          Array.from({ length: 1500 }, (_, i) => [
            `k${i}`,
            `{count, plural, one {# ${i}} few {# ${i}} many {# ${i}} other {# ${i}}}`,
          ]),
        ),
        undefined,
        { suffixPlurals: true, sourceLanguage: "en" },
      ),
  ]);
  // Plural objects whose forms all change, beside as many strings
  // (#1265).
  const plurals = (n: number, one: string, other: string) =>
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          [`p${i}`, { one: `${one} ${i}`, other: `${other} ${i}` }],
          [`s${i}`, `Text ${i}`],
        ]).flat(),
      ),
      null,
      2,
    ) + "\n";
  const pluralSource = plurals(1500, "{count} room", "{count} rooms");
  const pluralTarget = plurals(1500, "{count} Raum", "{count} Räume");
  cases.push([
    "1500 plural objects' forms changed, and 1500 strings",
    () =>
      entriesToMessages(
        pluralSource,
        Object.fromEntries(
          Array.from({ length: 1500 }, (_, i) => [
            [
              `p${i}`,
              `{count, plural, one {{count} Raum! ${i}} other {{count} Räume! ${i}}}`,
            ],
            [`s${i}`, `Neu ${i}`],
          ]).flat(),
        ),
        pluralTarget,
        { plurals: true },
      ),
  ]);
  // A list the target holds empty, every item translated (#1282).
  const items = Array.from({ length: 8000 }, (_, i) => `Item ${i}`);
  cases.push([
    "8000 items into a list the target holds as []",
    () =>
      entriesToMessages(
        JSON.stringify({ list: items }, null, 2) + "\n",
        Object.fromEntries(items.map((_, i) => [`list.${i}`, `Punkt ${i}`])),
        `{\n  "list": []\n}\n`,
      ),
  ]);
  for (const [name, run] of cases) {
    const start = performance.now();
    run();
    // Generous for a slow runner: the sequential path took 7–44 s.
    expect(performance.now() - start, name).toBeLessThan(3000);
  }
}, 120_000);

test("a plural whose path an earlier write of the same pull reached is written as the sequential pull writes it (#1265 review)", () => {
  const P = (forms: string) => `{count, plural, ${forms}}`;
  const sameBoth = (run: (sequential: boolean) => string) =>
    expect(run(false)).toBe(run(true));
  // A proposal under the plural, then the plural.
  sameBoth((sequential) =>
    applyMessagesOps(
      `{\n  "a": {\n    "one": "1",\n    "other": "2"\n  }\n}\n`,
      [
        { kind: "add", id: "a.few", text: "f" },
        { kind: "edit", id: "a", text: P("one {x} other {y}") },
      ],
      { plurals: true, sequential },
    ),
  );
  // A family the pull wrote under a plural it then writes.
  sameBoth((sequential) =>
    entriesToMessages(
      `{\n  "P.q_one": "a",\n  "P.q_other": "b",\n  "P": {\n    "one": "x",\n    "other": "y"\n  }\n}\n`,
      {
        "P.q": P("one {a} few {f} many {m} other {b}"),
        P: P("one {x} other {y}"),
      },
      `{\n  "P": {\n    "q_one": "a",\n    "q_other": "b"\n  }\n}\n`,
      {
        plurals: true,
        suffixPlurals: true,
        sourceLanguage: "en",
        sequential,
      },
    ),
  );
  // A plural object at one of a family's keys, which the family wrote.
  for (const flat of [false, true]) {
    const wrap = (inner: string) => (flat ? inner : `{"p": ${inner}}`);
    const key = (k: string) => (flat ? k : `p.${k}`);
    sameBoth((sequential) =>
      entriesToMessages(
        wrap(
          `{"b_one": "o", "b_other": "t", "b_few": {"one": "1", "other": "2"}}`,
        ),
        {
          [key("b")]: P("one {x} few {f} other {y}"),
          [key("b_few")]: P("one {x} other {y}"),
        },
        wrap(`{"b_one": "o", "b_other": "t"}`),
        {
          plurals: true,
          suffixPlurals: true,
          sourceLanguage: "en",
          sequential,
        },
      ),
    );
  }
  // A removed form holding its object's only line break.
  sameBoth((sequential) =>
    entriesToMessages(
      `{\n  "p": {\n    "a": {\n      "one": "1",\n      "other": "2"\n    },\n    "b": "str"\n  }\n}\n`,
      { "p.a": P("one {x} other {y}"), "p.b": "neu" },
      `{"p": { "a": { "one": "1", "other": "2",\n "few": "f" }, "b": "str" }}`,
      { plurals: true, sequential },
    ),
  );
});

test("a list's missing items appended in one splice are the bytes appended one at a time (#1282)", () => {
  const value = (r: () => number, depth = 0): unknown => {
    const roll = r();
    if (roll < 0.35 || depth > 1) return `v${Math.floor(r() * 99)}`;
    if (roll < 0.45) return {};
    if (roll < 0.55) return [];
    if (roll < 0.8)
      return Object.fromEntries(
        Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => [
          `k${i}`,
          value(r, depth + 1),
        ]),
      );
    return Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
      value(r, depth + 1),
    );
  };
  const render = (
    v: unknown,
    one: boolean,
    indent: string,
    unit: string,
    eol: string,
  ): string => {
    if (typeof v === "string") return JSON.stringify(v);
    const entries = Array.isArray(v)
      ? v.map((x) => [undefined, x] as const)
      : Object.entries(v as object);
    const [open, close] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) return open + close;
    const inner = indent + unit;
    const part = ([k, x]: readonly [string | undefined, unknown]) =>
      `${k === undefined ? "" : `${JSON.stringify(k)}: `}${render(x, one, inner, unit, eol)}`;
    return one
      ? `${open} ${entries.map(part).join(", ")} ${close}`
      : `${open}${eol}${entries.map((e) => inner + part(e)).join(`,${eol}`)}${eol}${indent}${close}`;
  };
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed * 31337);
    const unit = pick(r, ["  ", "    ", "\t"]);
    const eol = r() < 0.3 ? "\r\n" : "\n";
    const held = Array.from({ length: Math.floor(r() * 3) }, () => value(r));
    const listOne = r() < 0.3;
    const list = (indent: string) => {
      if (held.length === 0) return r() < 0.5 ? "[]" : `[${eol}${indent}]`;
      const inner = indent + unit;
      const item = (v: unknown) =>
        render(v, listOne || r() < 0.4, inner, unit, eol);
      return listOne
        ? `[ ${held.map(item).join(", ")} ]`
        : `[${eol}${held.map((v) => inner + item(v)).join(`,${eol}`)}${eol}${indent}]`;
    };
    const nested = r() < 0.5;
    const text =
      (r() < 0.15 ? "\uFEFF" : "") +
      (nested
        ? `{${eol}${unit}"a": {${eol}${unit}${unit}"l": ${list(unit + unit)}${eol}${unit}}${eol}}${eol}`
        : `{${eol}${unit}"l": ${list(unit)}${eol}}${eol}`);
    const path = nested ? ["a", "l"] : ["l"];
    const values = Array.from({ length: 1 + Math.floor(r() * 5) }, () =>
      value(r),
    );
    const oneAtATime = values.reduce<string>(
      (out, v) => appendItem(out, path, v, unit),
      text,
    );
    expect(appendItems(text, path, values, unit), `seed ${seed}`).toBe(
      oneAtATime,
    );
  }
});
