// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { StateChips } from "./state-chips";

afterEach(cleanup);

test("renders a chip per language reflecting its state", () => {
  render(
    <StateChips
      languages={["pt-PT", "en"]}
      states={{
        "pt-PT": { state: "verified", stale: false },
        en: { state: "untranslated", stale: false },
      }}
    />,
  );
  expect(screen.getByText("pt-PT")).toBeTruthy();
  expect(screen.getByText("en")).toBeTruthy();
  expect(screen.queryByText("stale")).toBeNull();
});

test("shows a stale badge when a language is stale", () => {
  render(
    <StateChips
      languages={["en"]}
      states={{ en: { state: "translated", stale: true } }}
    />,
  );
  expect(screen.getByText("stale")).toBeTruthy();
});

test("a language with no row defaults to untranslated", () => {
  render(<StateChips languages={["fr"]} states={{}} />);
  expect(screen.getByText("fr")).toBeTruthy();
});
