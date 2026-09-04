// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { TargetPane } from "./target-pane";

afterEach(cleanup);

const SOURCE = "{witness} viu {suspect} às {hour}.";
const slots = [
  { name: "witness", description: "Who saw it" },
  { name: "suspect", description: "Who was seen" },
  { name: "hour", description: "Time" },
];

function pane(initialText = "") {
  const action = vi.fn();
  render(
    <TargetPane
      action={action}
      source={SOURCE}
      slots={slots}
      language="en"
      initialText={initialText}
      slug="mm"
      stringKey="k"
      openedVersion={1}
    />,
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  const save = screen.getByRole("button", {
    name: "Save translation",
  }) as HTMLButtonElement;
  return { action, textarea, save };
}

test("tapping a placeholder chip inserts it at the caret", () => {
  const { textarea } = pane("saw  at");
  textarea.setSelectionRange(4, 4);
  fireEvent.click(screen.getByRole("button", { name: "{suspect}" }));
  expect(textarea.value).toBe("saw {suspect} at");
});

test("a draft missing a placeholder names it and disables save", () => {
  const { save } = pane("{witness} saw someone at {hour}.");
  expect(screen.getByText("Missing {suspect}")).toBeTruthy();
  expect(save.disabled).toBe(true);
});

test("an unexpected placeholder is named", () => {
  pane("{witness} saw {suspect} at {hour} with {weapon}.");
  expect(screen.getByText("Unexpected {weapon}")).toBeTruthy();
});

test("a valid draft enables save; an empty draft disables it without shouting", () => {
  const { textarea, save } = pane("{witness} saw {suspect} at {hour}.");
  expect(save.disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(textarea, { target: { value: "" } });
  expect(save.disabled).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the form carries the row and the version token", () => {
  const { textarea } = pane("x");
  const form = textarea.closest("form")!;
  const value = (name: string) =>
    form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
  expect(value("slug")).toBe("mm");
  expect(value("key")).toBe("k");
  expect(value("language")).toBe("en");
  expect(value("openedVersion")).toBe("1");
  expect(textarea.name).toBe("text");
});
