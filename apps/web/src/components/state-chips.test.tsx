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

test("the three states are visibly distinct, not only by colour", () => {
  render(
    <StateChips
      languages={["a", "b", "c"]}
      states={{
        a: { state: "untranslated", stale: false },
        b: { state: "translated", stale: false },
        c: { state: "verified", stale: false },
      }}
    />,
  );
  const chip = (language: string) =>
    screen.getByText(language).closest("span[title]")!;
  const classes = ["a", "b", "c"].map((l) => chip(l).className);
  expect(new Set(classes).size).toBe(3);
  // Untranslated is outlined (nothing filled), translated is filled in the
  // quiet tone, verified is filled in the strong tone and carries a mark.
  expect(chip("a").className).toMatch(/border/);
  expect(chip("a").className).not.toMatch(/bg-(muted|secondary|primary)\b/);
  expect(chip("b").className).toMatch(/bg-foreground\/15/);
  expect(chip("c").className).toMatch(/bg-primary/);
  expect(chip("c").textContent).toMatch(/✓/);
  expect(chip("b").textContent).not.toMatch(/✓/);
});
