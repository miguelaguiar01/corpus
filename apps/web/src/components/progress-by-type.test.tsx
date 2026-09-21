// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ProgressByType } from "./progress-by-type";

afterEach(cleanup);

const counts = (verified: number, translated: number, total: number) => ({
  verified,
  translated,
  untranslated: total - verified - translated,
  stale: 0,
  total,
});

const progress = {
  perLanguage: { "pt-PT": counts(1, 2, 3), en: counts(0, 0, 3) },
  perType: {
    "clue-skin": { "pt-PT": counts(1, 1, 2), en: counts(0, 0, 2) },
    chrome: { "pt-PT": counts(0, 1, 1), en: counts(0, 0, 1) },
  },
};

test("renders a section per language with its summary", () => {
  render(<ProgressByType progress={progress} sourceLanguage="pt-PT" />);
  expect(screen.getByRole("heading", { name: "pt-PT" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "en" })).toBeTruthy();
  expect(screen.getByText("1 verified, 2 translated of 3")).toBeTruthy();
});

test("renders a labelled bar per string type under each language", () => {
  render(<ProgressByType progress={progress} sourceLanguage="pt-PT" />);
  const bars = screen.getAllByRole("meter");
  expect(bars).toHaveLength(4);
  const skin = screen.getAllByRole("meter", { name: "clue-skin" });
  expect(skin[0]?.getAttribute("aria-valuenow")).toBe("2");
  expect(skin[0]?.getAttribute("aria-valuemax")).toBe("2");
});

test("names the three fills once, in a legend", () => {
  render(<ProgressByType progress={progress} sourceLanguage="pt-PT" />);
  const legend = screen.getByRole("list", { name: "Legend" });
  expect(legend.textContent).toBe("VerifiedTranslatedUntranslated");
});

test("renders nothing for a project with no rows", () => {
  const { container } = render(
    <ProgressByType progress={{ perLanguage: {}, perType: {} }} />,
  );
  expect(container.innerHTML).toBe("");
});

test("from eight languages on, a table with one row and one bar per language", () => {
  const perLanguage = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((l) => [
      l,
      counts(1, 1, 4),
    ]),
  );
  const perType = { chrome: perLanguage };
  render(<ProgressByType progress={{ perLanguage, perType }} />);
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getAllByRole("meter")).toHaveLength(9);
  expect(screen.getByRole("rowheader", { name: "i" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "a" })).toBeNull();
});

test("a table row opens its per-type breakdown behind a disclosure; one type has none", async () => {
  const user = userEvent.setup();
  const languages = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const perLanguage = Object.fromEntries(
    languages.map((l) => [l, counts(1, 1, 4)]),
  );
  const perType = {
    chrome: Object.fromEntries(
      languages.map((l) => [l, l === "c" ? counts(2, 0, 2) : counts(1, 0, 2)]),
    ),
    "clue-skin": Object.fromEntries(languages.map((l) => [l, counts(0, 1, 2)])),
  };
  render(<ProgressByType progress={{ perLanguage, perType }} />);
  expect(screen.getAllByRole("meter")).toHaveLength(9);
  const toggles = screen.getAllByRole("button", { expanded: false });
  expect(toggles).toHaveLength(9);
  expect(toggles[2]?.textContent).toContain("c");
  await user.click(toggles[2]!);
  expect(toggles[2]?.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("meter")).toHaveLength(11);
  expect(
    screen.getByRole("meter", { name: "chrome" }).getAttribute("aria-valuenow"),
  ).toBe("2");
  expect(
    screen
      .getByRole("meter", { name: "clue-skin" })
      .getAttribute("aria-valuenow"),
  ).toBe("1");
  await user.click(toggles[2]!);
  expect(screen.getAllByRole("meter")).toHaveLength(9);
  cleanup();

  render(
    <ProgressByType
      progress={{ perLanguage, perType: { chrome: perType.chrome } }}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getAllByRole("meter")).toHaveLength(9);
});

test("the table leads with the language that has the most left to do, the source language first of all", () => {
  const perLanguage = {
    "pt-PT": counts(4, 0, 4),
    ca: counts(0, 3, 4),
    de: counts(0, 0, 4),
    en: counts(0, 2, 4),
    fr: counts(0, 0, 4),
    it: counts(1, 1, 4),
    ja: counts(0, 1, 4),
    ko: counts(0, 4, 4),
    nl: counts(0, 3, 4),
  };
  render(
    <ProgressByType
      progress={{ perLanguage, perType: { chrome: perLanguage } }}
      sourceLanguage="pt-PT"
    />,
  );
  const rows = screen
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent?.replace(/[▸▾]/g, "").trim());
  // pt-PT pinned, then most untranslated first, ties by code: de and fr
  // have four, ja three, en and it two, ca and nl one, ko none.
  expect(rows).toEqual([
    "pt-PT",
    "de",
    "fr",
    "ja",
    "en",
    "it",
    "ca",
    "nl",
    "ko",
  ]);
});

test("under the table threshold the blocks keep the order the counts came in", () => {
  // Ordering would move every one of these: en has the most left, and
  // the source language is last rather than pinned.
  const perLanguage = {
    fr: counts(0, 2, 3),
    en: counts(0, 0, 3),
    "pt-PT": counts(3, 0, 3),
  };
  render(
    <ProgressByType
      progress={{ perLanguage, perType: { chrome: perLanguage } }}
      sourceLanguage="pt-PT"
    />,
  );
  expect(
    screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
  ).toEqual(["fr", "en", "pt-PT"]);
});
