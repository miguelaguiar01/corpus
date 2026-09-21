// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        "pt-PT": { state: "verified", stale: false, agentDraft: false },
        en: { state: "untranslated", stale: false, agentDraft: false },
        fr: { state: "verified", stale: false, agentDraft: false },
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
    screen.getByRole("link", { name: "fr" }).querySelector("[aria-hidden]"),
  ).toBeNull();
});

test("under the threshold every language is a link and the bar wraps them", () => {
  const languages = Array.from({ length: 11 }, (_, i) => `l${i}`);
  render(
    <LanguageBar
      languages={languages}
      sourceLanguage="l0"
      selected="l7"
      states={{}}
      hrefFor={(l) => `/p/mm/s/k?language=${l}`}
    />,
  );
  const nav = screen.getByRole("navigation");
  expect(nav.className).toContain("flex-wrap");
  expect(screen.getAllByRole("link")).toHaveLength(11);
});

function many(count: number, selected = "l7") {
  const languages = Array.from({ length: count }, (_, i) => `l${i}`);
  render(
    <LanguageBar
      languages={languages}
      sourceLanguage="l0"
      selected={selected}
      states={{ l0: { state: "verified", stale: false, agentDraft: false } }}
      hrefFor={(l) => (l === "l0" ? "/p/mm/s/k" : `/p/mm/s/k?language=${l}`)}
    />,
  );
}

test("below twelve languages the bar stays segments; from twelve it is a picker", async () => {
  many(11);
  expect(screen.getAllByRole("link")).toHaveLength(11);
  expect(screen.queryByRole("button")).toBeNull();
  cleanup();

  many(12);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0]?.textContent?.replace("✓", "").trim()).toBe("l0");
  expect(links[0]?.querySelector("[aria-hidden]")?.textContent).toBe("✓");
  const control = screen.getByRole("button");
  expect(control.textContent).toContain("l7");
  expect(control.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("the picker lists the languages, filters on the code as you type, links each, and closes on a pick", async () => {
  const user = userEvent.setup();
  many(12);
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(screen.getAllByRole("option")).toHaveLength(11);
  expect(
    screen.getByRole("option", { name: "l7" }).getAttribute("aria-selected"),
  ).toBe("true");
  await user.type(screen.getByRole("textbox"), "L1");
  const shown = screen.getAllByRole("option").map((o) => o.textContent);
  expect(shown).toEqual(["l1", "l10", "l11"]);
  expect(screen.getByRole("option", { name: "l10" }).getAttribute("href")).toBe(
    "/p/mm/s/k?language=l10",
  );
  await user.click(screen.getByRole("option", { name: "l10" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  await user.click(screen.getByRole("button"));
  await user.type(screen.getByRole("textbox"), "zz");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText("No language matches.")).toBeTruthy();
});
