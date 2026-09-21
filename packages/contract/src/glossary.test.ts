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

test("a marked script keeps its marks inside the word, so a near miss is not a match", () => {
  const terms = [
    { term: "कल", target: "yesterday" },
    { term: "काल", target: "time" },
  ];
  expect(glossaryMatches("काल", terms).map((e) => e.term)).toEqual(["काल"]);
});

test("an entry's forms match as the term does, and the entry shows once under its term", () => {
  const terms = [
    { term: "assassino", forms: ["assassinos", "assassina"], target: "killer" },
    { term: "vítima", target: "victim" },
  ];
  // The plural of a term with no forms is not the term.
  expect(
    glossaryMatches("Mais casos do que os ASSASSINOS e as vítimas.", terms).map(
      (e) => e.term,
    ),
  ).toEqual(["assassino"]);
  expect(
    glossaryMatches("A assassina fugiu.", terms).map((e) => e.term),
  ).toEqual(["assassino"]);
  expect(
    glossaryMatches("As vítimas.", [{ ...terms[1]!, forms: ["vítimas"] }]).map(
      (e) => e.term,
    ),
  ).toEqual(["vítima"]);
  expect(
    glossaryFileSchema.safeParse([{ term: "x", forms: [""], target: "y" }])
      .success,
  ).toBe(false);
});

test("a term in a script written without spaces matches as a run of characters", () => {
  const terms = [
    { term: "被害者", target: "victim" },
    { term: "書斎", target: "study" },
    { term: "庭師", target: "gardener" },
    { term: "ผู้ตาย", target: "the deceased" },
    { term: "vítima", target: "victim" },
  ];
  expect(
    glossaryMatches("{person}は書斎で被害者を見た。", terms).map((e) => e.term),
  ).toEqual(["被害者", "書斎"]);
  expect(
    glossaryMatches("พบผู้ตายในห้องสมุด", terms).map((e) => e.term),
  ).toEqual(["ผู้ตาย"]);
  // A Latin term still needs its whole word, beside an unspaced script or not.
  expect(
    glossaryMatches("A vitimazinha 被害者", terms).map((e) => e.term),
  ).toEqual(["被害者"]);
  // Katakana is matched as written: no folding across the syllabaries.
  expect(
    glossaryMatches("ニワシ", [{ term: "にわし", target: "gardener" }]),
  ).toEqual([]);
});

test("a term inside a rich-text tag is found; the tag's name is not a word", () => {
  const terms = [
    { term: "vítima", target: "victim" },
    { term: "link", target: "ligação" },
  ];
  expect(
    glossaryMatches("Veja a <link>vítima</link>.", terms).map((e) => e.term),
  ).toEqual(["vítima"]);
});
