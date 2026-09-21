// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { OtherLanguages } from "./other-languages";

afterEach(cleanup);

const translations = {
  "pt-PT": {
    state: "verified" as const,
    stale: false,
    text: "Olá",
    version: 1,
    agentDraft: false,
  },
  en: {
    state: "translated" as const,
    stale: true,
    text: "Hello",
    version: 2,
    agentDraft: false,
  },
  fr: {
    state: "untranslated" as const,
    stale: false,
    text: null,
    version: 0,
    agentDraft: false,
  },
};

test("lists every language but the excluded ones, with text, state and staleness", () => {
  render(
    <OtherLanguages
      languages={["pt-PT", "en", "fr"]}
      exclude={["pt-PT"]}
      translations={translations}
    />,
  );
  expect(screen.queryByText("Olá")).toBeNull();
  expect(screen.getByText("Hello")).toBeTruthy();
  expect(screen.getByText("stale")).toBeTruthy();
  expect(screen.getByText("fr")).toBeTruthy();
  expect(screen.getByText("No translation yet")).toBeTruthy();
});

test("renders nothing when no other language remains", () => {
  const { container } = render(
    <OtherLanguages
      languages={["pt-PT", "en"]}
      exclude={["pt-PT", "en"]}
      translations={translations}
    />,
  );
  expect(container.innerHTML).toBe("");
});

test("proofreading the source lists every target", () => {
  render(
    <OtherLanguages
      languages={["pt-PT", "en", "fr"]}
      exclude={["pt-PT", "pt-PT"]}
      translations={translations}
    />,
  );
  expect(screen.getByRole("heading", { name: "Other languages" })).toBeTruthy();
  expect(screen.getByText("Hello")).toBeTruthy();
  expect(screen.getByText("fr")).toBeTruthy();
  expect(screen.queryByText("Olá")).toBeNull();
});

test("a translated language wears the translated chip, not the untranslated one", () => {
  render(
    <OtherLanguages
      languages={["pt-PT", "en", "fr"]}
      exclude={["pt-PT"]}
      translations={translations}
    />,
  );
  expect(screen.getByText("Translated").className).not.toBe(
    screen.getByText("Untranslated").className,
  );
});

test("past five, the rest fold behind their count and open on demand", () => {
  const many = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((l) => [
      l,
      {
        state: "translated" as const,
        stale: false,
        text: `text ${l}`,
        version: 1,
        agentDraft: false,
      },
    ]),
  );
  render(
    <OtherLanguages
      languages={["src", ...Object.keys(many)]}
      exclude={["src"]}
      translations={many}
    />,
  );
  for (const l of ["a", "b", "c", "d", "e"])
    expect(screen.getByText(`text ${l}`)).toBeTruthy();
  const summary = screen.getByText("3 more languages");
  expect(summary.closest("details")?.open).toBe(false);
  expect(screen.getByText("text h")).toBeTruthy();
});
