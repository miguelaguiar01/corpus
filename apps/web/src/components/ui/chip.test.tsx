// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Chip, chipVariants } from "./chip";

afterEach(cleanup);

const TEXT = "pt-PT";
const TITLE = "Verified";

test("variants are distinct and only the state variants carry colour", () => {
  const variants = [
    "neutral",
    "outline",
    "solid",
    "key",
    "state-verified",
    "state-stale",
  ] as const;
  const classes = variants.map((variant) => chipVariants({ variant }));
  expect(new Set(classes).size).toBe(variants.length);
  expect(chipVariants({ variant: "state-verified" })).toMatch(
    /bg-state-verified/,
  );
  expect(chipVariants({ variant: "state-stale" })).toMatch(/bg-state-stale/);
  expect(chipVariants({ variant: "key" })).toMatch(/font-mono/);
  for (const variant of ["neutral", "outline", "solid", "key"] as const) {
    expect(chipVariants({ variant })).not.toMatch(/state-|destructive/);
  }
});

test("renders a span with a title and merges a class", () => {
  render(
    <Chip variant="outline" title={TITLE} className="extra">
      {TEXT}
    </Chip>,
  );
  const chip = screen.getByText(TEXT);
  expect(chip.tagName).toBe("SPAN");
  expect(chip.getAttribute("title")).toBe(TITLE);
  expect(chip.className).toMatch(/extra/);
});
