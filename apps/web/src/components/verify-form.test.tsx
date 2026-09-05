// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { VerifyForm } from "./verify-form";

afterEach(cleanup);

test("submits the string, language, version token, and queue as hidden fields", () => {
  const action = vi.fn();
  const { container } = render(
    <VerifyForm
      action={action}
      slug="mm"
      stringKey="skin.seen"
      openedVersion={1700000000000}
      queue="unverifiedSource"
      language="pt-PT"
    />,
  );
  const value = (name: string) =>
    container.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
  expect(value("slug")).toBe("mm");
  expect(value("key")).toBe("skin.seen");
  expect(value("openedVersion")).toBe("1700000000000");
  expect(value("queue")).toBe("unverifiedSource");
  expect(
    screen.getByRole("button", { name: "Mark pt-PT as verified" }),
  ).toBeTruthy();
});

test("omits the queue field when there is no queue", () => {
  const { container } = render(
    <VerifyForm
      action={vi.fn()}
      slug="mm"
      stringKey="k"
      openedVersion={1}
      language="en"
    />,
  );
  expect(container.querySelector('input[name="queue"]')).toBeNull();
  expect(
    screen.getByRole("button", { name: "Mark en as verified" }),
  ).toBeTruthy();
});
