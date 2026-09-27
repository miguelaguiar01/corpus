import { expect, test } from "vitest";
import { unreadableCatalogue } from "./catalogue-format";

test("a catalogue no adapter reads is named by its format, pointing at exec (#647)", () => {
  expect(unreadableCatalogue("po/fr.po")).toMatch(
    /^a gettext catalogue, which no adapter reads: .*exec/,
  );
  expect(unreadableCatalogue("config/locales/client.fr.yml")).toMatch(
    /^a YAML catalogue/,
  );
  expect(unreadableCatalogue("src/locales/messages.fr.xlf")).toMatch(
    /^an XLIFF catalogue: declare it \{ adapter: "xliff"/,
  );
  expect(unreadableCatalogue("Localizable.xcstrings")).toMatch(
    /^a String Catalog/,
  );
  expect(unreadableCatalogue("lang/app.fr.toml")).toMatch(
    /^\.toml is not a format any adapter reads/,
  );
});

test("a Qt Linguist .ts is told apart from TypeScript by its first bytes", () => {
  expect(
    unreadableCatalogue("lang/qbittorrent_en.ts", '<?xml version="1.0"?>'),
  ).toMatch(/^a Qt Linguist catalogue/);
  expect(unreadableCatalogue("lang/app_en.ts", "\uFEFF<TS version")).toMatch(
    /^a Qt Linguist catalogue/,
  );
  expect(
    unreadableCatalogue("src/i18n/en.ts", "export default { a: 'A' };"),
  ).toBeNull();
});

test("the formats the messages and table adapters read pass", () => {
  for (const file of [
    "a.json",
    "b.arb",
    "c.js",
    "d.mjs",
    "e.cjs",
    "f.ts",
    "g.mts",
    "h.cts",
    "I.JSON",
  ])
    expect(unreadableCatalogue(file)).toBeNull();
});

test("a format another adapter reads says which", () => {
  expect(unreadableCatalogue("i18n/fr/app.ftl")).toMatch(/adapter: "fluent"/);
  expect(unreadableCatalogue("res/values-fr/strings.xml")).toMatch(
    /adapter: "android"/,
  );
});
