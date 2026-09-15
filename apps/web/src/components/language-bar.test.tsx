// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { LanguageBar } from "./language-bar";

afterEach(cleanup);

function bar(selected = "en") {
  render(
    <LanguageBar
      languages={["pt-PT", "en", "fr"]}
      sourceLanguage="pt-PT"
      selected={selected}
      states={{
        "pt-PT": { state: "verified", stale: false },
        en: { state: "untranslated", stale: false },
      }}
      hrefFor={(language) =>
        language === "pt-PT" ? "/p/mm/s/k" : `/p/mm/s/k?language=${language}`
      }
    />,
  );
}

test("one segment per language, each a link, the selected one current", () => {
  bar();
  const links = screen.getAllByRole("link");
  expect(links.map((l) => l.textContent?.replace("✓", "").trim())).toEqual([
    "pt-PT",
    "en",
    "fr",
  ]);
  expect(links[1]?.getAttribute("aria-current")).toBe("page");
  expect(links[0]?.getAttribute("aria-current")).toBeNull();
  expect(links[2]?.getAttribute("href")).toBe("/p/mm/s/k?language=fr");
  expect(links[0]?.getAttribute("href")).toBe("/p/mm/s/k");
});

test("the source language carries its verified mark, hidden from the name", () => {
  bar("pt-PT");
  const source = screen.getByRole("link", { name: "pt-PT" });
  expect(source.getAttribute("aria-current")).toBe("page");
  expect(source.querySelector("[aria-hidden]")?.textContent).toBe("✓");
  expect(
    screen.getByRole("link", { name: "en" }).querySelector("[aria-hidden]"),
  ).toBeNull();
});
