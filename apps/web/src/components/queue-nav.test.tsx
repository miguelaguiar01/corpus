// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { QueueNav } from "./queue-nav";

afterEach(cleanup);

const items = [
  { stringId: 1, key: "a", language: "pt-PT" },
  { stringId: 2, key: "b", language: "pt-PT" },
  { stringId: 3, key: "c/d", language: "pt-PT" },
];
const queue = {
  kind: "unverifiedSource" as const,
  count: 3,
  first: items[0]!,
  items,
};

test("shows the position and links to the previous and next items", () => {
  render(<QueueNav slug="mm" queue={queue} current={items[1]!} />);
  expect(screen.getByText("2 of 3")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Previous" }).getAttribute("href"),
  ).toBe("/p/mm/s/a?queue=unverifiedSource&language=pt-PT");
  expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
    "/p/mm/s/c%2Fd?queue=unverifiedSource&language=pt-PT",
  );
});

test("at the ends, the missing direction is not a link", () => {
  render(<QueueNav slug="mm" queue={queue} current={items[2]!} />);
  expect(screen.getByRole("link", { name: "Previous" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  expect(screen.getByText("Next")).toBeTruthy();
});

test("an item no longer in the queue shows the queue name and only a way back", () => {
  render(
    <QueueNav
      slug="mm"
      queue={queue}
      current={{ stringId: 9, language: "pt-PT" }}
    />,
  );
  expect(screen.queryByText(/of 3/)).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Unverified source" })
      .getAttribute("href"),
  ).toBe("/p/mm");
});
