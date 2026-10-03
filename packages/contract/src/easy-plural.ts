// easy_localization's plural rules where an app passes
// `ignorePluralRules: false` (#961): the copy of intl's
// `plural_rules.dart` the package vendors (3.0.7), looked up by the
// locale's language code alone, `pt` for pt-PT, and evaluated at
// precision 0, so `v`, `f` and `t` are 0 and `i` is the number rounded.
// Its data is an older CLDR's: Maltese has no `two`, French no `many`.
// A code the table lacks has no rule, and the package picks by value.
//
// Ported from easy_localization's lib/src/plural_rules.dart, itself
// from Dart's intl: Copyright (c) 2016, the Dart project authors;
// BSD-style license.

type Rule = (n: number, i: number) => string;

const inRange = (x: number, low: number, high: number) => x >= low && x <= high;

const other: Rule = () => "other";
const en: Rule = (_n, i) => (i === 1 ? "one" : "other");
const es: Rule = (n) => (n === 1 ? "one" : "other");
const hi: Rule = (n, i) => (i === 0 || n === 1 ? "one" : "other");
const fr: Rule = (_n, i) => (i === 0 || i === 1 ? "one" : "other");
const ak: Rule = (n) => (inRange(n, 0, 1) ? "one" : "other");
const fil: Rule = (_n, i) =>
  i === 1 || i === 2 || i === 3 || ![4, 6, 9].includes(i % 10)
    ? "one"
    : "other";
const br: Rule = (n) => {
  if (n % 10 === 1 && ![11, 71, 91].includes(n % 100)) return "one";
  if (n % 10 === 2 && ![12, 72, 92].includes(n % 100)) return "two";
  if (
    (inRange(n % 10, 3, 4) || n % 10 === 9) &&
    !inRange(n % 100, 10, 19) &&
    !inRange(n % 100, 70, 79) &&
    !inRange(n % 100, 90, 99)
  )
    return "few";
  if (n !== 0 && n % 1000000 === 0) return "many";
  return "other";
};
const sr: Rule = (_n, i) => {
  if (i % 10 === 1 && i % 100 !== 11) return "one";
  if (inRange(i % 10, 2, 4) && !inRange(i % 100, 12, 14)) return "few";
  return "other";
};
const ro: Rule = (n, i) => {
  if (i === 1) return "one";
  if (n === 0 || (n !== 1 && inRange(n % 100, 1, 19))) return "few";
  return "other";
};
const cs: Rule = (_n, i) => {
  if (i === 1) return "one";
  if (inRange(i, 2, 4)) return "few";
  return "other";
};
const pl: Rule = (_n, i) => {
  if (i === 1) return "one";
  if (inRange(i % 10, 2, 4) && !inRange(i % 100, 12, 14)) return "few";
  if (
    (i !== 1 && inRange(i % 10, 0, 1)) ||
    inRange(i % 10, 5, 9) ||
    inRange(i % 100, 12, 14)
  )
    return "many";
  return "other";
};
const lv: Rule = (n) => {
  if (n % 10 === 0 || inRange(n % 100, 11, 19)) return "zero";
  if (n % 10 === 1 && n % 100 !== 11) return "one";
  return "other";
};
const he: Rule = (n, i) => {
  if (i === 1) return "one";
  if (i === 2) return "two";
  if ((n < 0 || n > 10) && n % 10 === 0) return "many";
  return "other";
};
const mt: Rule = (n) => {
  if (n === 1) return "one";
  if (n === 0 || inRange(n % 100, 2, 10)) return "few";
  if (inRange(n % 100, 11, 19)) return "many";
  return "other";
};
const si: Rule = (n) => (n === 0 || n === 1 ? "one" : "other");
const cy: Rule = (n) =>
  ({ 0: "zero", 1: "one", 2: "two", 3: "few", 6: "many" })[n] ?? "other";
const da: Rule = (n) => (n === 1 ? "one" : "other");
const ru: Rule = (_n, i) => {
  if (i % 10 === 1 && i % 100 !== 11) return "one";
  if (inRange(i % 10, 2, 4) && !inRange(i % 100, 12, 14)) return "few";
  if (i % 10 === 0 || inRange(i % 10, 5, 9) || inRange(i % 100, 11, 14))
    return "many";
  return "other";
};
const be: Rule = (n) => {
  if (n % 10 === 1 && n % 100 !== 11) return "one";
  if (inRange(n % 10, 2, 4) && !inRange(n % 100, 12, 14)) return "few";
  if (n % 10 === 0 || inRange(n % 10, 5, 9) || inRange(n % 100, 11, 14))
    return "many";
  return "other";
};
const mk: Rule = (_n, i) => (i % 10 === 1 ? "one" : "other");
const ga: Rule = (n) => {
  if (n === 1) return "one";
  if (n === 2) return "two";
  if (inRange(n, 3, 6)) return "few";
  if (inRange(n, 7, 10)) return "many";
  return "other";
};
const pt: Rule = (n) => (n >= 0 && n < 2 ? "one" : "other");
const is: Rule = (_n, i) => (i % 10 === 1 && i % 100 !== 11 ? "one" : "other");
const ar: Rule = (n) => {
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n === 2) return "two";
  if (inRange(n % 100, 3, 10)) return "few";
  if (inRange(n % 100, 11, 99)) return "many";
  return "other";
};
const sl: Rule = (_n, i) => {
  if (i % 100 === 1) return "one";
  if (i % 100 === 2) return "two";
  if (inRange(i % 100, 3, 4)) return "few";
  return "other";
};
const lt: Rule = (n) => {
  if (n % 10 === 1 && !inRange(n % 100, 11, 19)) return "one";
  if (inRange(n % 10, 2, 9) && !inRange(n % 100, 11, 19)) return "few";
  return "other";
};

// By language code, as `pluralRules[locale.languageCode]` reads it; the
// table's region keys (pt_PT, en_US) are never looked up.
const RULES: Record<string, Rule> = {
  af: es,
  am: hi,
  ar,
  az: es,
  be,
  bg: es,
  bn: hi,
  br,
  bs: sr,
  ca: en,
  chr: es,
  cs,
  cy,
  da,
  de: en,
  el: es,
  en,
  es,
  et: en,
  eu: es,
  fa: hi,
  fi: en,
  fil,
  fr,
  ga,
  gl: en,
  gsw: es,
  gu: hi,
  haw: es,
  he,
  hi,
  hr: sr,
  hu: es,
  hy: fr,
  id: other,
  in: other,
  is,
  it: en,
  iw: he,
  ja: other,
  ka: es,
  kk: es,
  km: other,
  kn: hi,
  ko: other,
  ky: es,
  ln: ak,
  lo: other,
  lt,
  lv,
  mk,
  ml: es,
  mn: es,
  mo: ro,
  mr: hi,
  ms: other,
  mt,
  my: other,
  nb: es,
  ne: es,
  nl: en,
  no: es,
  or: es,
  pa: ak,
  pl,
  pt,
  ro,
  ru,
  sh: sr,
  si,
  sk: cs,
  sl,
  sq: es,
  sr,
  sv: en,
  sw: en,
  ta: es,
  te: es,
  th: other,
  tl: fil,
  tr: es,
  uk: ru,
  ur: en,
  uz: es,
  vi: other,
  zh: other,
  zu: hi,
};

function ruleOf(language: string): Rule | undefined {
  const code = language.split(/[-_]/)[0]!.toLowerCase();
  return Object.hasOwn(RULES, code) ? RULES[code] : undefined;
}

// The category the package picks for `n` in `language`, or undefined
// where its table has no rule and it picks by value.
export function easyLocalizationCategory(
  language: string,
  n: number,
): string | undefined {
  const rule = ruleOf(language);
  if (!rule) return undefined;
  const i = Math.sign(n) * Math.round(Math.abs(n));
  return rule(n, i);
}

// The categories the table's rule reaches for a language: those an
// integer below a million reaches, which a plural needs, and those a
// million and up reach beside them, which it may hold (#997). Undefined
// where the table has no rule.
export function easyLocalizationCategories(
  language: string,
): { required: string[]; allowed: string[] } | undefined {
  if (!ruleOf(language)) return undefined;
  const below = new Set<string>();
  for (let n = 0; n <= 1000; n++)
    below.add(easyLocalizationCategory(language, n)!);
  for (const n of [10_000, 100_000, 999_999])
    below.add(easyLocalizationCategory(language, n)!);
  const above = new Set(below);
  for (const n of [1e6, 2e6]) above.add(easyLocalizationCategory(language, n)!);
  const order = ["zero", "one", "two", "few", "many", "other"];
  // `other` is what a missing form resolves to, whatever the rule.
  return {
    required: order.filter((c) => below.has(c)),
    allowed: order.filter((c) => above.has(c) || c === "other"),
  };
}
