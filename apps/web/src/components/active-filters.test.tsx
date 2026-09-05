// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { Facet } from "@/catalogue/facets";
import { ActiveFilters } from "./active-filters";

afterEach(cleanup);

const FACETS: Facet[] = [
  { kind: "type", key: "type", options: ["chrome"] },
  {
    kind: "enum",
    key: "meta.mood",
    field: "mood",
    label: "Mood",
    options: ["dry"],
  },
];

test("renders nothing when the list is unfiltered", () => {
  const { container } = render(
    <ActiveFilters
      basePath="/c"
      facets={FACETS}
      active={new URLSearchParams()}
    />,
  );
  expect(container.innerHTML).toBe("");
});

test("one chip per active filter, each a link that drops only that filter", () => {
  render(
    <ActiveFilters
      basePath="/c"
      facets={FACETS}
      active={
        new URLSearchParams("type=chrome&meta.mood=dry&q=verified&cursor=9")
      }
    />,
  );
  const links = screen.getAllByRole("link");
  expect(links.map((l) => l.textContent)).toEqual([
    "chrome",
    "dry",
    "verified",
  ]);
  expect(links[0]?.getAttribute("href")).toBe("/c?meta.mood=dry&q=verified");
  expect(links[1]?.getAttribute("title")).toBe("Mood");
  expect(links[2]?.getAttribute("href")).toBe("/c?type=chrome&meta.mood=dry");
  expect(screen.getByRole("link", { name: "Remove chrome" })).toBeTruthy();
});
