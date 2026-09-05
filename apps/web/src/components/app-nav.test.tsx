// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AppNav } from "./app-nav";

const pathname = vi.hoisted(() => ({ current: "/p/manor" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

const current = () =>
  screen
    .getAllByRole("link")
    .filter((a) => a.getAttribute("aria-current") === "page")
    .map((a) => a.textContent);

test("marks the overview only on the project root", () => {
  pathname.current = "/p/manor";
  render(<AppNav slug="manor" maintainer={false} />);
  expect(current()).toEqual(["Overview"]);
});

test("marks the catalogue on the catalogue and in the editor", () => {
  pathname.current = "/p/manor/catalogue";
  const { unmount } = render(<AppNav slug="manor" maintainer={false} />);
  expect(current()).toEqual(["Catalogue"]);
  unmount();
  pathname.current = "/p/manor/s/greeting";
  render(<AppNav slug="manor" maintainer={false} />);
  expect(current()).toEqual(["Catalogue"]);
});

test("shows settings to maintainers only", () => {
  pathname.current = "/p/manor/settings";
  const { unmount } = render(<AppNav slug="manor" maintainer={false} />);
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  unmount();
  render(<AppNav slug="manor" maintainer />);
  expect(current()).toEqual(["Settings"]);
});
