import { expect, test } from "vitest";
import {
  foldTerm,
  glossaryFileSchema,
  glossaryMatches,
  glossarySchema,
} from "./glossary";

const entries = [
  { term: "vítima", target: "victim", note: "never 'the deceased'" },
  { term: "janela", target: "window" },
  { term: "sala de estar", target: "living room" },
  { term: "estar", target: "to be" },
];

test("a file is an array of term, target and an optional note; a snapshot keys files by language", () => {
  expect(glossaryFileSchema.safeParse(entries).success).toBe(true);
  expect(
    glossaryFileSchema.safeParse([{ term: "", target: "x" }]).success,
  ).toBe(false);
  expect(glossaryFileSchema.safeParse([{ term: "x" }]).success).toBe(false);
  expect(glossarySchema.safeParse({ en: entries, fr: [] }).success).toBe(true);
});

test("folding drops case and accents", () => {
  expect(foldTerm("Vítima")).toBe("vitima");
  expect(foldTerm("JANELA")).toBe("janela");
});

test("terms match as whole words, case- and accent-insensitively, in the glossary's order", () => {
  const matched = glossaryMatches(
    "A VITIMA foi vista à janela. Uma janelinha não conta.",
    entries,
  );
  expect(matched.map((e) => e.term)).toEqual(["vítima", "janela"]);
});

test("a multi-word term matches as a run of words, and its parts alone do not stand for it", () => {
  expect(
    glossaryMatches("Estava na sala de estar.", entries).map((e) => e.term),
  ).toEqual(["sala de estar", "estar"]);
  expect(
    glossaryMatches("Vai estar na sala.", entries).map((e) => e.term),
  ).toEqual(["estar"]);
});

test("placeholders and punctuation around a word do not hide it", () => {
  expect(
    glossaryMatches("{person} viu a vítima, à janela!", entries).map(
      (e) => e.term,
    ),
  ).toEqual(["vítima", "janela"]);
  expect(glossaryMatches("", entries)).toEqual([]);
  expect(glossaryMatches("Nada aqui.", [])).toEqual([]);
});

test("apostrophes and hyphens split words, so a term inside a compound still matches", () => {
  const terms = [
    { term: "vítima", target: "victim" },
    { term: "água", target: "water" },
    { term: "janela", target: "window" },
  ];
  expect(
    glossaryMatches("A vítima's d'água estufa-janela.", terms).map(
      (e) => e.term,
    ),
  ).toEqual(["vítima", "água", "janela"]);
});

test("placeholder names, select arguments and branch keys are not words of the source", () => {
  const terms = [
    { term: "person", target: "pessoa" },
    { term: "select", target: "escolher" },
    { term: "other", target: "outro" },
    { term: "visto", target: "seen" },
  ];
  expect(
    glossaryMatches(
      "{person} foi {person_gender, select, m {visto} other {vista}}.",
      terms,
    ).map((e) => e.term),
  ).toEqual(["visto"]);
});

test("only Latin accents fold; marks that are letters in their script stay", () => {
  expect(foldTerm("किताब")).toBe("किताब");
  expect(foldTerm("がき")).not.toBe(foldTerm("かき"));
  expect(foldTerm("Ção")).toBe("cao");
});
