// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ProjectCard } from "./project-card";

afterEach(cleanup);

const PROGRESS = {
  en: { untranslated: 0, translated: 2, verified: 1, stale: 0, total: 3 },
  "pt-PT": { untranslated: 3, translated: 0, verified: 0, stale: 0, total: 3 },
};
const COUNTS = { untranslated: 3, stale: 1, unverifiedSource: 2 };
const NAME = "Moonlight Manor";

test("links the whole card to the dashboard and names the project", () => {
  render(
    <ProjectCard
      slug="manor"
      name={NAME}
      languages={["en", "pt-PT"]}
      progress={PROGRESS}
      counts={COUNTS}
    />,
  );
  const link = screen.getByRole("link", { name: new RegExp(NAME) });
  expect(link.getAttribute("href")).toBe("/p/manor");
});

test("shows a chip and a meter per language and the three queue counts", () => {
  render(
    <ProjectCard
      slug="manor"
      name={NAME}
      languages={["en", "pt-PT"]}
      progress={PROGRESS}
      counts={COUNTS}
    />,
  );
  expect(screen.getAllByRole("meter")).toHaveLength(2);
  expect(
    screen.getByRole("meter", { name: "en" }).getAttribute("aria-valuenow"),
  ).toBe("3");
  expect(screen.getByText("Untranslated").previousSibling?.textContent).toBe(
    "3",
  );
  expect(screen.getByText("Stale").previousSibling?.textContent).toBe("1");
  expect(
    screen.getByText("Unverified source").previousSibling?.textContent,
  ).toBe("2");
});
