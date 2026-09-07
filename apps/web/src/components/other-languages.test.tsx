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
  },
  en: { state: "translated" as const, stale: true, text: "Hello", version: 2 },
  fr: { state: "untranslated" as const, stale: false, text: null, version: 0 },
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
