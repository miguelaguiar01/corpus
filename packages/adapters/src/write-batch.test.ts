import { expect, test } from "vitest";
import { applyMessagesOps, entriesToMessages, type SourceOp } from "./write";

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
    else out[key] = derive(r, value);
  }
  if (r() < 0.2) out[`extra${Math.floor(r() * 9)}`] = "Extra";
  return out;
}

function translationsFor(r: () => number, ids: string[], nested: boolean) {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const roll = r();
    if (roll < 0.4) continue;
    out[id] =
      roll < 0.5
        ? "{count, plural, one {# um} other {# muitos}}"
        : `Tradução ${id}`;
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
  // Plural objects whose forms all change, beside as many strings; and
  // a mix where a form goes beside one added (#1265).
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
  cases.push(
    [
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
    ],
    [
      "1500 plural objects, a form removed beside one added",
      () =>
        entriesToMessages(
          pluralSource,
          Object.fromEntries(
            Array.from({ length: 1500 }, (_, i) => [
              `p${i}`,
              `{count, plural, one {{count} Raum ${i}} few {{count} Räume ${i}}}`,
            ]),
          ),
          pluralTarget,
          { plurals: true },
        ),
    ],
  );
  for (const [name, run] of cases) {
    const start = performance.now();
    run();
    // Generous for a slow runner: the sequential path took 7–44 s.
    expect(performance.now() - start, name).toBeLessThan(3000);
  }
}, 120_000);
