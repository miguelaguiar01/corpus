// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LanguagesInput } from "./languages-input";

afterEach(cleanup);

const LABEL = "Languages (comma-separated)";

test("shows the typed codes as chips and keeps the text as the posted value", () => {
  render(<LanguagesInput label={LABEL} />);
  const input = screen.getByLabelText(LABEL) as HTMLInputElement;
  expect(screen.queryByRole("list")).toBeNull();
  fireEvent.change(input, { target: { value: " pt-PT, en ,,fr" } });
  expect(input.value).toBe(" pt-PT, en ,,fr");
  expect(input.getAttribute("name")).toBe("languages");
  const chips = screen.getAllByRole("listitem").map((li) => li.textContent);
  expect(chips).toEqual(["pt-PT", "en", "fr"]);
});
