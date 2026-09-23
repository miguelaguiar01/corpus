// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
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
  await user.type(screen.getByRole("combobox"), "bet");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("Beta");
});

test("the switcher shares the picker's keyboard and outside-click behaviour (#488)", async () => {
  const user = userEvent.setup();
  render(<ProjectSwitcher current="alpha" projects={PROJECTS} />);
  const control = screen.getByRole("button");
  await user.click(control);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(control);
  await user.click(control);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(push).toHaveBeenCalledWith(`/p/${PROJECTS[1]!.slug}`);
  expect(screen.queryByRole("listbox")).toBeNull();
});
