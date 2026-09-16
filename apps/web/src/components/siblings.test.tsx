// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { Siblings as SiblingsData } from "@/strings/siblings";
import { Siblings } from "./siblings";

afterEach(cleanup);

const siblings: SiblingsData = {
  total: 12,
  items: [
    {
      id: 2,
      key: "dossier.fail.1",
      source: "Segunda deixa",
      translations: {
        en: { state: "translated" as const, stale: true, text: "Second quip" },
      },
    },
    {
      id: 3,
      key: "dossier.fail.2",
      source: "Terceira deixa",
      translations: {},
    },
  ],
};

test("lists each sibling as a link with its source, and the selected target's text and state", () => {
  render(<Siblings slug="mm" siblings={siblings} language="en" />);
  expect(screen.getByRole("heading", { name: "Siblings" })).toBeTruthy();
  expect(screen.getByText(/2 of 12 strings/)).toBeTruthy();
  const first = screen.getByRole("link", { name: /dossier\.fail\.1/ });
  expect(first.getAttribute("href")).toContain("language=en");
  expect(screen.getByText("Second quip")).toBeTruthy();
  expect(screen.getByText("stale")).toBeTruthy();
  expect(screen.getByText("No translation yet")).toBeTruthy();
});

test("on the source view the links carry no language and no target text", () => {
  render(<Siblings slug="mm" siblings={siblings} />);
  const first = screen.getByRole("link", { name: /dossier\.fail\.1/ });
  expect(first.getAttribute("href")).not.toContain("language=");
  expect(screen.queryByText("Second quip")).toBeNull();
});

test("renders nothing when the string has no siblings", () => {
  const { container } = render(
    <Siblings slug="mm" siblings={{ total: 0, items: [] }} language="en" />,
  );
  expect(container.innerHTML).toBe("");
});
