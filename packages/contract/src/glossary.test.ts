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

test("an entry's forms match as written, and the entry shows once under its term", () => {
  const terms = [
    { term: "assassino", forms: ["assassinos", "assassina"], target: "killer" },
    { term: "vítima", target: "victim" },
  ];
  expect(
    glossaryMatches("A assassina fugiu.", terms).map((e) => e.term),
  ).toEqual(["assassino"]);
  expect(
    glossaryMatches("As divisões.", [
      { term: "divisão", forms: ["divisões"], target: "room" },
    ]).map((e) => e.term),
  ).toEqual(["divisão"]);
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

test("a term matches its inflections: the term, or the term less a final a, e or o, and at most two more letters", () => {
  const terms = [
    { term: "assassino", target: "killer" },
    { term: "vítima", target: "victim" },
    { term: "suspeito", target: "suspect" },
    { term: "hora do crime", target: "time of the crime" },
    { term: "draft", target: "rascunho" },
  ];
  const hits = (source: string) =>
    glossaryMatches(source, terms).map((e) => e.term);
  expect(hits("A pressa já estragou mais casos do que os assassinos.")).toEqual(
    ["assassino"],
  );
  expect(hits("A assassina e as assassinas.")).toEqual(["assassino"]);
  expect(hits("As vítimas e os suspeitos.")).toEqual(["vítima", "suspeito"]);
  expect(hits("As horas do crime.")).toEqual(["hora do crime"]);
  expect(hits("Two drafts, one drafted.")).toEqual(["draft"]);
  // A term ending in a, e or o keeps that letter too.
  expect(
    glossaryMatches("The heroes echoed.", [
      { term: "hero", target: "herói" },
      { term: "echo", target: "eco" },
    ]).map((e) => e.term),
  ).toEqual(["hero", "echo"]);
  // A marked script's ending is marks: Hindi's plural.
  expect(
    glossaryMatches("किताबें", [{ term: "किताब", target: "book" }]).map(
      (e) => e.term,
    ),
  ).toEqual(["किताब"]);
  // An ending is letters.
  expect(
    glossaryMatches("In 100000 draft2.", [
      { term: "1000", target: "mil" },
      { term: "draft", target: "rascunho" },
    ]),
  ).toEqual([]);
  // Three letters more, or a different stem, is another word.
  expect(hits("Os assassinatos, a vitimização, o drafting.")).toEqual([]);
  // Each word of a multi-word term inflects by itself; the run still counts.
  expect(hits("Uma hora do dia, o crime.")).toEqual([]);
});

test("a term under four letters, and an entry with match exact, match only as written", () => {
  const terms = [
    { term: "pé", target: "foot" },
    { term: "sol", target: "sun" },
    {
      term: "pista",
      match: "exact" as const,
      forms: ["pistas"],
      target: "clue",
    },
  ];
  const hits = (source: string) =>
    glossaryMatches(source, terms).map((e) => e.term);
  expect(hits("Os pés ao solo.")).toEqual([]);
  expect(hits("O pé ao sol.")).toEqual(["pé", "sol"]);
  expect(hits("A pista e as pistas.")).toEqual(["pista"]);
  expect(hits("Uma pistola.")).toEqual([]);
  expect(hits("As pistas.")).toEqual(["pista"]);
  // Exact without the form: the plural is another word.
  expect(
    glossaryMatches("As pistas.", [
      { term: "pista", match: "exact", target: "clue" },
    ]),
  ).toEqual([]);
  expect(
    glossaryMatches("A pistinha.", [{ term: "pista", target: "clue" }]),
  ).toEqual([]);
  expect(
    glossaryFileSchema.safeParse([{ term: "x", match: "loose", target: "y" }])
      .success,
  ).toBe(false);
});
