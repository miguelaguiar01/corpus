// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CatalogueRow } from "./catalogue-row";

afterEach(cleanup);

const SOURCE = "Mark {language} as verified";

test("links to the string and shows key, type, source and states", () => {
  render(
    <CatalogueRow
      href="/p/mm/s/verify.button"
      stringId="verify.button"
      type="chrome"
      source={SOURCE}
      languages={["en", "pt-PT"]}
      states={{
        en: { state: "verified", stale: false },
        "pt-PT": { state: "untranslated", stale: false },
      }}
    />,
  );
  const link = screen.getByRole("link");
  expect(link.getAttribute("href")).toBe("/p/mm/s/verify.button");
  expect(screen.getByText("verify.button").className).toMatch(/font-mono/);
  expect(screen.getByText("chrome")).toBeTruthy();
  expect(screen.getByText(SOURCE)).toBeTruthy();
  expect(screen.getByText("en").closest("span[title]")?.className).toMatch(
    /bg-state-verified/,
  );
});
