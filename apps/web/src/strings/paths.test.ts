import { expect, test } from "vitest";
import { keyFromSegment, languageSwitchPath, stringPath } from "./paths";

test("stringPath encodes the key and drops undefined query values", () => {
  expect(stringPath("mm", "a.b c", { language: "en", queue: undefined })).toBe(
    "/p/mm/s/a.b%20c?language=en",
  );
});

test("the switcher keeps the queue only for a row the queue contains and drops language for the source", () => {
  const href = languageSwitchPath({
    slug: "mm",
    key: "k",
    sourceLanguage: "pt-PT",
    queue: { kind: "untranslated", languages: ["en"] },
  });
  expect(href("en")).toBe("/p/mm/s/k?language=en&queue=untranslated");
  expect(href("fr")).toBe("/p/mm/s/k?language=fr");
  expect(href("pt-PT")).toBe("/p/mm/s/k");
  const noQueue = languageSwitchPath({
    slug: "mm",
    key: "k",
    sourceLanguage: "pt-PT",
  });
  expect(noQueue("en")).toBe("/p/mm/s/k?language=en");
});

test("keyFromSegment decodes a page segment once and refuses bad encoding", () => {
  expect(keyFromSegment("New%20template")).toBe("New template");
  expect(keyFromSegment(encodeURIComponent("Uploading… {{ progress }}%"))).toBe(
    "Uploading… {{ progress }}%",
  );
  expect(keyFromSegment("app.title")).toBe("app.title");
  expect(keyFromSegment("bad%ZZ")).toBeNull();
  // The round trip with stringPath's encoding holds for a natural key.
  const key = "Are you sure? Deleting <em>{{ name }}</em> is 100% permanent.";
  const segment = stringPath("p", key).split("/s/")[1]!;
  expect(keyFromSegment(segment)).toBe(key);
});
