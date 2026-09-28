import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { GETTEXT_PLURALS } from "./gettextplurals";

const INTEGERS = [
  ...Array.from({ length: 2001 }, (_, i) => i),
  1_000_000,
  2_000_000,
  10_000_000,
];

test("every compiled expression picks, for each integer, the form of the category Intl gives it (#812)", () => {
  const disagree: string[] = [];
  for (const [locale, { nplurals, plural, forms }] of Object.entries(
    GETTEXT_PLURALS,
  )) {
    expect(forms).toHaveLength(nplurals);
    const f = new Function("n", `return Number(${plural});`) as (
      n: number,
    ) => number;
    let rules: Intl.PluralRules;
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      continue;
    }
    // A locale the runtime has no data for falls back to another's
    // rules; only its own are compared.
    if (rules.resolvedOptions().locale !== locale) continue;
    for (const n of INTEGERS)
      if (f(n) !== forms.indexOf(rules.select(n))) {
        disagree.push(`${locale} ${n}`);
        break;
      }
  }
  expect(disagree).toEqual([]);
});

test("the known languages have gettext's forms (#812)", () => {
  const nplurals = (l: string) => GETTEXT_PLURALS[l]!.nplurals;
  expect(GETTEXT_PLURALS.pl!.forms).toEqual(["one", "few", "many"]);
  expect(GETTEXT_PLURALS.ru!.forms).toEqual(["one", "few", "many"]);
  expect(GETTEXT_PLURALS.lv!.forms).toEqual(["zero", "one", "other"]);
  expect(nplurals("ar")).toBe(6);
  expect(nplurals("cy")).toBe(6);
  expect(GETTEXT_PLURALS.ja!.plural).toBe("0");
  expect(GETTEXT_PLURALS.fr!.forms).toEqual(["one", "many", "other"]);
});

test("the committed table is what bin/gen-gettext-plurals compiles from CLDR (#812)", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const run = spawnSync("node", ["bin/gen-gettext-plurals.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
});
