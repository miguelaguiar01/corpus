// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CopyButton } from "./copy-button";

afterEach(cleanup);

test("copies the value and says so", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyButton value="tok_123" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
  expect(writeText).toHaveBeenCalledWith("tok_123");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy(),
  );
});
