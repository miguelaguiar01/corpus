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
        "pt-PT": { state: "verified", stale: false, agentDraft: false },
        en: { state: "untranslated", stale: false, agentDraft: false },
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
      states={{ en: { state: "translated", stale: true, agentDraft: false } }}
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
        a: { state: "untranslated", stale: false, agentDraft: false },
        b: { state: "translated", stale: false, agentDraft: false },
        c: { state: "verified", stale: false, agentDraft: false },
      }}
    />,
  );
  const chip = (language: string) =>
    screen.getByText(language).closest("span[title]")!;
  const classes = ["a", "b", "c"].map((l) => chip(l).className);
  expect(new Set(classes).size).toBe(3);
  // Untranslated is outlined (nothing filled), translated is filled in the
  // achromatic tone, verified is filled in the state colour and carries a
  // mark.
  expect(chip("a").className).toMatch(/border/);
  expect(chip("a").className).not.toMatch(/bg-(muted|secondary|state)/);
  expect(chip("b").className).toMatch(/bg-secondary/);
  expect(chip("c").className).toMatch(/bg-state-verified/);
  expect(chip("c").textContent).toMatch(/✓/);
  expect(chip("b").textContent).not.toMatch(/✓/);
});

test("marks a translated row the agent actor last edited", () => {
  render(
    <StateChips
      languages={["en", "fr"]}
      states={{
        en: { state: "translated", stale: false, agentDraft: true },
        fr: { state: "verified", stale: false, agentDraft: true },
      }}
    />,
  );
  expect(screen.getAllByText("agent")).toHaveLength(1);
});

function many(count: number) {
  const languages = Array.from({ length: count }, (_, i) => `l${i}`);
  const states = Object.fromEntries(
    languages.map((l, i) => [
      l,
      {
        state: i === 0 ? "verified" : i < 3 ? "translated" : "untranslated",
        stale: i === 2,
        agentDraft: false,
      },
    ]),
  ) as Parameters<typeof StateChips>[0]["states"];
  return { languages, states };
}

test("an agent draft is counted, as a chip shows it under the threshold", () => {
  const languages = Array.from({ length: 12 }, (_, i) => `l${i}`);
  const states = Object.fromEntries(
    languages.map((l, i) => [
      l,
      { state: "translated", stale: false, agentDraft: i < 4 },
    ]),
  ) as Parameters<typeof StateChips>[0]["states"];
  render(<StateChips languages={languages} states={states} />);
  expect(screen.getByText("12 translated")).toBeTruthy();
  expect(screen.getByText("4 agent")).toBeTruthy();
});

test("under the threshold every language keeps its chip", () => {
  const { languages, states } = many(11);
  render(<StateChips languages={languages} states={states} />);
  expect(screen.getAllByText(/^l\d+$/)).toHaveLength(11);
  expect(screen.queryByText(/untranslated$/i)).toBeNull();
});

test("from the threshold the strip is a count per state, with no disclosure where it cannot have one", () => {
  const { languages, states } = many(12);
  const { container } = render(
    <StateChips languages={languages} states={states} />,
  );
  expect(screen.queryAllByText(/^l\d+$/)).toHaveLength(0);
  expect(screen.getByText("9 untranslated")).toBeTruthy();
  expect(screen.getByText("2 translated")).toBeTruthy();
  expect(screen.getByText("1 verified")).toBeTruthy();
  expect(screen.getByText("1 stale")).toBeTruthy();
  expect(container.querySelector("details")).toBeNull();
});

test("foldable: the named languages keep their chips, the rest are counted, and the full strip is behind the disclosure", () => {
  const { languages, states } = many(12);
  const { container } = render(
    <StateChips
      languages={languages}
      states={states}
      shown={["l0", "l5"]}
      foldable
    />,
  );
  const details = container.querySelector("details");
  expect(details).toBeTruthy();
  const summary = details!.querySelector("summary")!;
  expect(summary.textContent).toContain("l0");
  expect(summary.textContent).toContain("l5");
  expect(summary.textContent).toContain("8 untranslated");
  expect(summary.textContent).toContain("2 translated");
  expect(summary.textContent).not.toContain("l7");
  // The control says what it opens, so its name is not a language code.
  expect(summary.textContent).toContain("each of the 12 languages");
  // The named chips appear twice: in the summary, and in the full strip.
  expect(screen.getAllByText(/^l\d+$/)).toHaveLength(14);
});
