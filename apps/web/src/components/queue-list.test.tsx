// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { QueueList } from "./queue-list";

afterEach(cleanup);

const first = {
  untranslated: { stringId: 1, key: "skin.seen", language: "en" },
  stale: null,
  unverifiedSource: { stringId: 1, key: "skin.seen", language: "pt-PT" },
};

test("each queue shows its count and label", () => {
  render(
    <QueueList
      slug="mm"
      counts={{ untranslated: 3, stale: 0, unverifiedSource: 2 }}
      first={first}
    />,
  );
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByText("Untranslated")).toBeTruthy();
  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getByText("Stale")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.getByText("Unverified source")).toBeTruthy();
});

test("a non-empty queue links to its first item with the queue in the URL", () => {
  render(
    <QueueList
      slug="mm"
      counts={{ untranslated: 3, stale: 0, unverifiedSource: 2 }}
      first={first}
    />,
  );
  const link = screen.getByRole("link", { name: /Unverified source/ });
  expect(link.getAttribute("href")).toBe(
    "/p/mm/s/skin.seen?queue=unverifiedSource&language=pt-PT",
  );
});

test("an empty queue is not a link", () => {
  render(
    <QueueList
      slug="mm"
      counts={{ untranslated: 3, stale: 0, unverifiedSource: 2 }}
      first={first}
    />,
  );
  expect(screen.queryByRole("link", { name: /Stale/ })).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});
