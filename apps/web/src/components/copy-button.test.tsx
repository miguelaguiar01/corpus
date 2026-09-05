// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CopyButton } from "./copy-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("copies the value, says so, and reverts after a moment", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyButton value="tok_123" />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith("tok_123");
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByRole("button", { name: "Copy token" })).toBeTruthy();
});

test("a clipboard that refuses leaves the label alone", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("denied"));
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyButton value="tok_123" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Copy token" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});
