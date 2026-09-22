// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CatalogueRow } from "./catalogue-row";

afterEach(cleanup);

const SOURCE = "Mark {language} as verified";

test("links to the string and shows key, type, source and states", () => {
  render(
    <CatalogueRow
      href="/p/mm/s/verify.button"
      stringId="verify.button"
      type="chrome"
      source={SOURCE}
      languages={["en", "pt-PT"]}
      states={{
        en: { state: "verified", stale: false, agentDraft: false },
        "pt-PT": { state: "untranslated", stale: false, agentDraft: false },
      }}
    />,
  );
  const link = screen.getByRole("link");
  expect(link.getAttribute("href")).toBe("/p/mm/s/verify.button");
  expect(screen.getByText("verify.button").className).toMatch(/font-mono/);
  expect(screen.getByText("chrome")).toBeTruthy();
  expect(screen.getByText(SOURCE)).toBeTruthy();
  expect(screen.getByText("en").closest("span[title]")?.className).toMatch(
    /bg-state-verified/,
  );
});

test("a pending proposal marks the row", () => {
  render(
    <CatalogueRow
      href="/p/mm/s/k"
      stringId="k"
      type="chrome"
      source={SOURCE}
      languages={["en"]}
      states={{}}
      pending
    />,
  );
  expect(screen.getByText("proposed")).toBeTruthy();
});

test("past a dozen languages, the filtered language keeps its chip beside the counts (#510)", () => {
  const languages = Array.from({ length: 12 }, (_, i) => `l${i}`);
  const states = Object.fromEntries(
    languages.map((l, i) => [
      l,
      {
        state: i < 3 ? ("translated" as const) : ("untranslated" as const),
        stale: false,
        agentDraft: false,
      },
    ]),
  );
  render(
    <CatalogueRow
      href="/p/mm/s/k"
      stringId="k"
      type="chrome"
      source={SOURCE}
      languages={languages}
      states={states}
      shown={["l5"]}
    />,
  );
  expect(
    screen.getByText("l5").closest("span[title]")?.getAttribute("title"),
  ).toBe("Untranslated");
  expect(screen.queryByText("l4")).toBeNull();
  expect(screen.getByText("8 untranslated")).toBeTruthy();
  expect(screen.getByText("3 translated")).toBeTruthy();
});
