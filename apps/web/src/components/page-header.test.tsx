// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { PageHeader } from "./page-header";

afterEach(cleanup);

const TITLE = "Moonlight Manor";
const META = "Corpus build v0.5.0";
const ACTION = "Act";

test("renders the title as the page heading with optional meta and actions", () => {
  render(
    <PageHeader
      title={TITLE}
      meta={META}
      actions={<a href="/x">{ACTION}</a>}
    />,
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TITLE);
  expect(screen.getByText(META)).toBeTruthy();
  expect(screen.getByRole("link", { name: ACTION })).toBeTruthy();
});

test("renders only the title when nothing else is given", () => {
  render(<PageHeader title={TITLE} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TITLE);
  expect(screen.queryByRole("link")).toBeNull();
});
