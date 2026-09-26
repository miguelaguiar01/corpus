// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AddStringForm } from "./form";

vi.mock("@/proposals/actions", () => ({ proposeAddAction: vi.fn() }));

test("a namespaced file's option says the prefix its keys take (#582)", () => {
  render(
    <AddStringForm
      slug="mm"
      sources={[
        {
          path: "locales/{lang}/admin.json",
          adapter: "messages",
          type: "ui",
          namespace: "admin",
        },
        { path: "src/ui/{lang}.json", adapter: "messages", type: "chrome" },
      ]}
    />,
  );
  expect(
    screen.getByRole("option", {
      name: "locales/{lang}/admin.json (ui), keys prefixed admin:",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("option", { name: "src/ui/{lang}.json (chrome)" }),
  ).toBeTruthy();
});
