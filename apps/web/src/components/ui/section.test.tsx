// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Section } from "./section";

afterEach(cleanup);

const HEADING = "What to work on";
const DESCRIPTION = "Queues first.";
const BODY = "body";

test("renders a section landmark with a level-2 heading by default", () => {
  render(
    <Section heading={HEADING} description={DESCRIPTION}>
      <p>{BODY}</p>
    </Section>,
  );
  const heading = screen.getByRole("heading", { level: 2 });
  expect(heading.textContent).toBe(HEADING);
  expect(screen.getByText(DESCRIPTION)).toBeTruthy();
  expect(screen.getByText(BODY)).toBeTruthy();
});

test("takes a heading level and a meta slot beside the heading", () => {
  render(
    <Section heading={HEADING} level={3} meta="12">
      <p>{BODY}</p>
    </Section>,
  );
  expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(HEADING);
  expect(screen.getByText("12")).toBeTruthy();
});
