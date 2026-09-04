// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { ProjectSwitcher } from "./project-switcher";

afterEach(cleanup);

const PROJECTS = [
  { slug: "alpha", name: "Alpha" },
  { slug: "beta", name: "Beta" },
];

test("shows the current project and opens to list all projects", async () => {
  const user = userEvent.setup();
  render(<ProjectSwitcher current="alpha" projects={PROJECTS} />);
  expect(screen.getByRole("button").textContent).toContain("Alpha");

  await user.click(screen.getByRole("button"));
  const options = screen.getAllByRole("option");
  expect(options).toHaveLength(2);
  expect(
    screen.getByRole("option", { name: "Beta" }).getAttribute("href"),
  ).toBe("/p/beta");
});

test("filters the list by the search query", async () => {
  const user = userEvent.setup();
  render(<ProjectSwitcher current="alpha" projects={PROJECTS} />);
  await user.click(screen.getByRole("button"));
  await user.type(screen.getByRole("textbox"), "bet");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Beta");
});
