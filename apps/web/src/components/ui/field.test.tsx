// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Field } from "./field";
import { Input } from "./input";

afterEach(cleanup);

const LABEL = "Display name";
const HINT = "Shown next to your edits.";
const ERROR = "Pick a shorter name.";

test("labels its control and describes it by the hint", () => {
  render(
    <Field label={LABEL} hint={HINT}>
      <Input name="name" />
    </Field>,
  );
  const input = screen.getByLabelText(LABEL);
  expect(input.getAttribute("name")).toBe("name");
  expect(input.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText(HINT).id).toBe(
    input.getAttribute("aria-describedby"),
  );
  expect(input.getAttribute("aria-invalid")).toBeNull();
});

test("an error marks the control invalid and is announced", () => {
  render(
    <Field label={LABEL} error={ERROR}>
      <Input name="name" />
    </Field>,
  );
  const input = screen.getByLabelText(LABEL);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toBe(ERROR);
  expect(input.getAttribute("aria-describedby")).toBe(
    screen.getByRole("alert").id,
  );
});
