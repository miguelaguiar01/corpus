// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Banner } from "./banner";

afterEach(cleanup);

const TEXT = "The source text changed.";

test("an error banner is an alert; the other tones are status", () => {
  const { unmount } = render(<Banner tone="error">{TEXT}</Banner>);
  expect(screen.getByRole("alert").textContent).toBe(TEXT);
  unmount();
  render(<Banner tone="warning">{TEXT}</Banner>);
  expect(screen.getByRole("status").textContent).toBe(TEXT);
});

test("only warning and error carry colour; info and success are achromatic", () => {
  const cls = (tone: "info" | "success" | "warning" | "error") => {
    const { unmount } = render(<Banner tone={tone}>{TEXT}</Banner>);
    const c = screen.getByText(TEXT).className;
    unmount();
    return c;
  };
  expect(cls("warning")).toMatch(/bg-state-stale/);
  expect(cls("error")).toMatch(/destructive/);
  expect(cls("info")).not.toMatch(/state-|destructive/);
  expect(cls("success")).not.toMatch(/state-|destructive/);
});
