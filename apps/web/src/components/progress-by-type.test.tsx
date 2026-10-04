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
  invalid: 0,
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
    <ProgressByType
      progress={{ perLanguage: {}, perType: {} }}
      sourceLanguage="pt-PT"
    />,
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
  render(
    <ProgressByType
      progress={{ perLanguage, perType }}
      sourceLanguage="pt-PT"
    />,
  );
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
  render(
    <ProgressByType
      progress={{ perLanguage, perType }}
      sourceLanguage="pt-PT"
    />,
  );
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
      sourceLanguage="pt-PT"
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

test("a language's invalid rows are counted beside its states, in blocks and in the table, and nowhere when there are none (#911)", async () => {
  const user = userEvent.setup();
  const withInvalid = (p: ReturnType<typeof counts>, invalid: number) => ({
    ...p,
    invalid,
  });
  render(
    <ProgressByType
      progress={{
        perLanguage: {
          "pt-PT": counts(1, 2, 3),
          en: withInvalid(counts(0, 2, 3), 2),
        },
        perType: {
          "clue-skin": {
            "pt-PT": counts(1, 1, 2),
            en: withInvalid(counts(0, 1, 2), 1),
          },
          chrome: {
            "pt-PT": counts(0, 1, 1),
            en: withInvalid(counts(0, 1, 1), 1),
          },
        },
      }}
      sourceLanguage="pt-PT"
    />,
  );
  // The language's count, read apart from the states, and each type's.
  expect(screen.getByText("· 2 invalid").parentElement?.textContent).toBe(
    "0 verified, 2 translated of 3 ·\u00a02 invalid",
  );
  expect(screen.getAllByText("1 invalid")).toHaveLength(2);
  expect(screen.queryByText("0 invalid")).toBeNull();
  // Every type's bar keeps a slot for the count, so the bars end
  // together: pt-PT's two bars have empty ones.
  const bars = screen.getAllByRole("meter");
  expect(bars).toHaveLength(4);
  for (const bar of bars)
    expect(bar.nextElementSibling?.className).toContain("w-24");
  cleanup();

  const languages = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  const perLanguage = Object.fromEntries(
    languages.map((l) => [
      l,
      l === "c" ? withInvalid(counts(1, 1, 4), 3) : counts(1, 1, 4),
    ]),
  );
  render(
    <ProgressByType
      progress={{
        perLanguage,
        perType: { chrome: perLanguage, ui: perLanguage },
      }}
      sourceLanguage="pt-PT"
    />,
  );
  // Beside the counts, and under the bar where the counts column is hidden.
  expect(screen.getAllByText("3 invalid")).toHaveLength(1);
  expect(screen.getByText("· 3 invalid").closest("td")?.textContent).toBe(
    "1 verified, 1 translated of 4 ·\u00a03 invalid",
  );
  const toggles = screen.getAllByRole("button", { expanded: false });
  await user.click(toggles.find((t) => t.textContent?.includes("c"))!);
  expect(screen.getAllByText("3 invalid")).toHaveLength(3);
});

test("a source variant sorts after every target, labelled as falling back to the source, its numbers raw (#699)", () => {
  const languages = ["en", "en-GB", "de", "fr", "es", "it", "pt", "nl", "pl"];
  const perLanguage = Object.fromEntries(
    languages.map((l, i) => [
      l,
      l === "en-GB" ? counts(0, 3, 10) : counts(0, 10 - i, 10),
    ]),
  );
  render(
    <ProgressByType
      progress={{ perLanguage, perType: {} }}
      sourceLanguage="en"
      sourceVariants={["en-GB"]}
    />,
  );
  const rows = screen.getAllByRole("row").slice(1);
  const heads = rows.map((r) => r.querySelector("th")?.textContent ?? "");
  expect(heads[0]).toBe("en");
  // The row's header is the code alone; the label sits under the bar,
  // so the narrow column never wraps it.
  expect(heads.at(-1)).toBe("en-GB");
  expect(rows.at(-1)?.textContent).toContain("falls back to en");
  expect(
    screen.getAllByText("0 verified, 3 translated of 10"),
  ).not.toHaveLength(0);
  cleanup();
  // In blocks too.
  render(
    <ProgressByType
      progress={{
        perLanguage: {
          en: counts(0, 0, 3),
          "en-GB": counts(0, 0, 3),
          de: counts(0, 3, 3),
        },
        perType: {},
      }}
      sourceLanguage="en"
      sourceVariants={["en-GB"]}
    />,
  );
  const headings = screen.getAllByRole("heading").map((h) => h.textContent);
  // A line of its own under the heading, so the counts beside it keep
  // their room at phone width.
  const heading = screen.getAllByRole("heading").at(-1)!;
  expect(heading.textContent).toBe("en-GB");
  expect(heading.closest("section")?.textContent).toContain("falls back to en");
});
