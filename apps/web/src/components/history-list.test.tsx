// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { HistoryList } from "./history-list";

afterEach(cleanup);

const at = new Date("2026-09-04T10:00:00Z");

test("each entry shows who, the language, the state change, and the time", () => {
  render(
    <HistoryList
      history={[
        {
          id: 2,
          language: "en",
          actor: "ana",
          at,
          oldText: null,
          newText: "Continue",
          oldState: "untranslated",
          newState: "translated",
        },
        {
          id: 1,
          language: "pt-PT",
          actor: "rui",
          at,
          oldText: "Continuar",
          newText: "Continuar",
          oldState: "translated",
          newState: "verified",
        },
      ]}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain("ana");
  expect(items[0]?.textContent).toContain("en");
  expect(items[0]?.textContent).toContain("Untranslated");
  expect(items[0]?.textContent).toContain("Translated");
  expect(items[0]?.querySelector("time")?.getAttribute("datetime")).toBe(
    at.toISOString(),
  );
  expect(items[1]?.textContent).toContain("Verified");
});

test("a text change shows the new text", () => {
  render(
    <HistoryList
      history={[
        {
          id: 1,
          language: "en",
          actor: "ana",
          at,
          oldText: "Go on",
          newText: "Continue",
          oldState: "translated",
          newState: "translated",
        },
      ]}
    />,
  );
  expect(screen.getByText("Continue")).toBeTruthy();
});

test("an empty history says so", () => {
  render(<HistoryList history={[]} />);
  expect(screen.getByText("No edits yet.")).toBeTruthy();
});
