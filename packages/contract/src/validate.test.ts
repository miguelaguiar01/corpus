import { describe, expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import type { Library } from "./strings";
import { parseIcu, partsOf, pluralCategoriesOf } from "./icu";
import { renderPreview } from "./preview";
import {
  bareAtOf,
  chromeDollarsOf,
  nestedCountsOf,
  richTextFor,
  validateTranslation,
  type ValidationError,
} from "./validate";

const SIGHTING = moonlightManor.strings[0]!.source;

function errorsOf(
  source: string,
  target: string,
  language?: string,
  syntax?: Library,
): ValidationError[] {
  const result = validateTranslation(source, target, language, syntax);
  return result.ok ? [] : result.errors;
}

describe("placeholders must survive", () => {
  test.each([
    ["exact set, reordered", "Olá {b} e {a}", "Hi {a} and {b}"],
    [
      "placeholder moved into a select branch",
      "{g, select, m {he} f {she}} took {item}",
      "{g, select, m {he took {item}} f {she took {item}}}",
    ],
    ["no placeholders on either side", "Continuar", "Continue"],
  ])("%s → ok", (_, source, target) => {
    expect(validateTranslation(source, target)).toEqual({ ok: true });
  });

  test("a missing placeholder is named", () => {
    expect(
      errorsOf("{witness} saw {suspect}", "Someone saw {suspect}"),
    ).toEqual([{ code: "missing-placeholder", name: "witness" }]);
  });

  test("an unexpected placeholder is named", () => {
    expect(errorsOf("{witness} saw it", "{witness} saw {suspect}")).toEqual([
      { code: "unexpected-placeholder", name: "suspect" },
    ]);
  });

  test("several problems are all reported, missing first", () => {
    expect(errorsOf("{a} {b}", "{b} {c} {d}")).toEqual([
      { code: "missing-placeholder", name: "a" },
      { code: "unexpected-placeholder", name: "c" },
      { code: "unexpected-placeholder", name: "d" },
    ]);
  });

  test("a select argument used as a plain placeholder is unexpected", () => {
    expect(errorsOf("{g, select, m {he} f {she}}", "{g}")).toEqual([
      { code: "unexpected-placeholder", name: "g" },
    ]);
  });
});

describe("placeholders inside branches", () => {
  test("a placeholder present in only one target branch still counts as surviving", () => {
    // Whole-message sets, by design: the translator may legitimately drop a
    // slot from one branch ("she left" vs "he left with {item}").
    expect(
      validateTranslation(
        "{g, select, m {he took {item}} f {she took {item}}}",
        "{g, select, m {he took {item}} f {she left}}",
      ),
    ).toEqual({ ok: true });
  });

  test("duplicate source selects on one argument union their keys", () => {
    expect(
      errorsOf(
        "{g, select, m {he} f {she}} and {g, select, m {him} n {them}}",
        "{g, select, m {he} f {she} n {they}}",
      ),
    ).toEqual([]);
  });
});

describe("selects may collapse but not be malformed", () => {
  test("both source selects collapsed into plain text is fine", () => {
    const target =
      "{person} was seen at the {room_de} window at {hour} — and was not alone.";
    expect(validateTranslation(SIGHTING, target)).toEqual({ ok: true });
  });

  test("keeping one select and collapsing the other is fine", () => {
    const target =
      "{person} was {person_gender, select, m {seen} f {seen}} at the {room_de} window at {hour} — and was not alone.";
    expect(validateTranslation(SIGHTING, target)).toEqual({ ok: true });
  });

  test("a select on an argument the source does not select on is rejected", () => {
    expect(
      errorsOf("{name} left", "{name} {mood, select, a {left} b {went}}"),
    ).toEqual([{ code: "unknown-select", arg: "mood" }]);
  });

  test("branch keys must match the source select's keys", () => {
    expect(
      errorsOf(
        "{g, select, m {he} f {she}}",
        "{g, select, m {he} f {she} n {they}}",
      ),
    ).toEqual([{ code: "unexpected-branch", arg: "g", key: "n" }]);
    expect(
      errorsOf("{g, select, m {he} f {she}}", "{g, select, m {he}}"),
    ).toEqual([{ code: "missing-branch", arg: "g", key: "f" }]);
  });

  test("a malformed select is an ICU error with a position", () => {
    const errors = errorsOf(
      SIGHTING,
      "{person} foi {person_gender, select, m {visto} f {vista}",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "invalid-icu", where: "target" });
    expect(typeof (errors[0] as { message: string }).message).toBe("string");
    expect(typeof (errors[0] as { position: number }).position).toBe("number");
  });

  test("a target may pluralise a value the source has, and a count must survive as {n} or as a plural on n", () => {
    expect(
      validateTranslation(
        "{n} items",
        "{n, plural, one {# item} other {# items}}",
      ),
    ).toEqual({ ok: true });
    const PLURAL = "{n, plural, one {Falta # marca.} other {Faltam # marcas.}}";
    expect(validateTranslation(PLURAL, "{n} marks left.")).toEqual({
      ok: true,
    });
    expect(validateTranslation(PLURAL, "{n, plural, other {残り#個}}")).toEqual(
      {
        ok: true,
      },
    );
    expect(errorsOf(PLURAL, "Marks left.")).toEqual([
      { code: "missing-placeholder", name: "n" },
    ]);
    expect(errorsOf("Continue", "{n, plural, one {x} other {y}}")).toEqual([
      { code: "unknown-plural", arg: "n" },
    ]);
  });

  test("with the target language, a plural must carry the categories that language uses; =N is free", () => {
    const PLURAL = "{n, plural, one {Falta # marca.} other {Faltam # marcas.}}";
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, one {# mark} other {# marks}}",
        "en",
      ),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, =0 {None} one {# mark} other {# marks}}",
        "en",
      ),
    ).toEqual({ ok: true });
    // A category the language uses but the translation lacks is
    // incomplete, not invalid (#556): ICU falls back to `other`, and
    // react-intl catalogues ship this way in every Romance language.
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, one {# метка} other {# меток}}",
        "ru",
      ),
    ).toEqual({
      ok: true,
      incomplete: [
        { code: "missing-category", arg: "n", key: "few" },
        { code: "missing-category", arg: "n", key: "many" },
      ],
    });
    // Beside a real error the incomplete ones ride along, apart.
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, one {# метка {x}} other {# меток}}",
        "ru",
      ),
    ).toEqual({
      ok: false,
      errors: [{ code: "unexpected-placeholder", name: "x" }],
      incomplete: [
        { code: "missing-category", arg: "n", key: "few" },
        { code: "missing-category", arg: "n", key: "many" },
      ],
    });
    // A branch the language never selects is dead text, incomplete
    // rather than invalid (#651): the runtime's CLDR may differ.
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, one {# mark} few {# marks} other {# marks}}",
        "en",
      ),
    ).toEqual({
      ok: true,
      incomplete: [{ code: "unexpected-category", arg: "n", key: "few" }],
    });
    // No language, or one the runtime does not know: only the shape is checked.
    expect(
      validateTranslation(PLURAL, "{n, plural, few {x} other {y}}"),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(
        PLURAL,
        "{n, plural, few {x} other {y}}",
        "not a tag",
      ),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(PLURAL, "{n, plural, few {x} other {y}}", "tlh"),
    ).toEqual({ ok: true });
  });
});

describe("the source side", () => {
  test("an unparsable source is reported once, without checking the target", () => {
    expect(errorsOf("{broken", "anything")).toEqual([
      expect.objectContaining({ code: "invalid-icu", where: "source" }),
    ]);
  });

  test("the fixture's greenhouse string validates against its own source", () => {
    expect(validateTranslation(SIGHTING, SIGHTING)).toEqual({ ok: true });
  });
});

describe("printf", () => {
  test("a dropped or added verb is named as written; a reorder needs an index in the source's style (#594)", () => {
    const go = "%s pushed %d commits to %s";
    expect(
      validateTranslation(
        go,
        "%s enviou %d commits para %s",
        "pt-PT",
        "printf",
      ),
    ).toEqual({ ok: true });
    // Dropping the middle verb shifts the last one to its position,
    // where it reads as a changed verb at 2 and a missing 3; the two are
    // what one dropped %d looks like, and are said as that (#614).
    expect(
      errorsOf(go, "%s enviou commits para %s", "pt-PT", "printf"),
    ).toEqual([{ code: "missing-placeholder", name: "2", written: "%d" }]);
    // The same for a verb dropped early in a longer string: every verb
    // after it shifted one place, which is one omission, not three
    // changes and a fourth missing.
    expect(
      errorsOf("%d of %s in %f at %x", "%s %f %x", "pt-PT", "printf"),
    ).toEqual([{ code: "missing-placeholder", name: "1", written: "%d" }]);
    // A drop that also changes a verb is not one omission: said as it reads.
    expect(
      errorsOf("%d of %s in %f at %x", "%s %d %x", "pt-PT", "printf"),
    ).toEqual([
      { code: "missing-placeholder", name: "4", written: "%x" },
      {
        code: "changed-verb",
        name: "1",
        expected: "%d",
        actual: "%s",
        indexed: "%n$s or %[n]s",
        moved: true,
      },
      {
        code: "changed-verb",
        name: "2",
        expected: "%s",
        actual: "%d",
        indexed: "%n$d or %[n]d",
        moved: true,
      },
      {
        code: "changed-verb",
        name: "3",
        expected: "%f",
        actual: "%x",
        indexed: "%n$x or %[n]x",
        moved: true,
      },
    ]);
    expect(
      errorsOf(go, "%s pushed %d commits to %s extra %d", "pt-PT", "printf"),
    ).toEqual([{ code: "unexpected-placeholder", name: "4", written: "%d" }]);
    // Unindexed verbs are named by their order, so a verb moved without
    // an index reads as another type at its position; every moved verb
    // indexed is the translator's order. Go's style when the source
    // writes it, or a %v.
    expect(
      errorsOf(go, "Para %s, %s enviou %d commits", "pt-PT", "printf"),
    ).toEqual([
      {
        code: "changed-verb",
        name: "2",
        expected: "%d",
        actual: "%s",
        indexed: "%n$s or %[n]s",
        moved: true,
      },
      {
        code: "changed-verb",
        name: "3",
        expected: "%s",
        actual: "%d",
        indexed: "%n$d or %[n]d",
        moved: true,
      },
    ]);
    expect(
      validateTranslation(
        go,
        "Para %3$s, %1$s enviou %2$d commits",
        "pt-PT",
        "printf",
      ),
    ).toEqual({ ok: true });
    expect(errorsOf("%[1]s: %v", "%v de %[1]s", "de", "printf")).toEqual([
      { code: "missing-placeholder", name: "2", written: "%v" },
      {
        code: "changed-verb",
        name: "1",
        expected: "%[1]s",
        actual: "%v",
        indexed: "%[n]v",
        moved: true,
      },
    ]);
    expect(
      validateTranslation("%[1]s: %v", "%[2]v de %[1]s", "de", "printf"),
    ).toEqual({ ok: true });
    // C's style only when the source writes a %n$ index itself.
    expect(errorsOf("%1$s has %2$d", "%d de %s", "pt-PT", "printf")).toEqual([
      {
        code: "changed-verb",
        name: "1",
        expected: "%1$s",
        actual: "%d",
        indexed: "%n$d",
        moved: true,
      },
      {
        code: "changed-verb",
        name: "2",
        expected: "%2$d",
        actual: "%s",
        indexed: "%n$s",
        moved: true,
      },
    ]);
    // A length modifier is part of the verb: %ld against %lu is a
    // changed verb naming both, and the index form keeps it (#614).
    expect(
      validateTranslation("%ld of %lu", "%ld de %lu", "pt-PT", "printf"),
    ).toEqual({ ok: true });
    expect(errorsOf("%ld of %lu", "%lu de %lu", "pt-PT", "printf")).toEqual([
      {
        code: "changed-verb",
        name: "1",
        expected: "%ld",
        actual: "%lu",
        indexed: "%n$lu or %[n]lu",
        moved: true,
      },
    ]);
    expect(errorsOf("%ld items", "%d items", "pt-PT", "printf")).toEqual([
      {
        code: "changed-verb",
        name: "1",
        expected: "%ld",
        actual: "%d",
        indexed: "%n$d or %[n]d",
        moved: false,
      },
    ]);
    // A verb whose type changed where it stands moved nowhere: no index
    // form helps (#645). A source written with neither index form gets
    // both, since the catalogue's language decides which one works.
    expect(
      errorsOf("Could not verify: %s", "Nie vdalosia: %i", "uk", "printf"),
    ).toEqual([
      {
        code: "changed-verb",
        name: "1",
        expected: "%s",
        actual: "%i",
        indexed: "%n$i or %[n]i",
        moved: false,
      },
    ]);
    // iOS: %@ is checked like any verb, and dropped it is named as written.
    expect(
      validateTranslation("%@ sent %ld", "%@ enviou %ld", "pt-PT", "printf"),
    ).toEqual({ ok: true });
    expect(
      errorsOf("%1$@ sent %2$ld", "%2$ld enviados", "pt-PT", "printf"),
    ).toEqual([{ code: "missing-placeholder", name: "1", written: "%1$@" }]);
    // %% is a percent on both sides and never a placeholder.
    expect(
      validateTranslation("%d%% done", "%d %% feito", "pt-PT", "printf"),
    ).toEqual({ ok: true });
  });
});

describe("rich-text tags", () => {
  // HTML text, where <br> is void: Android's strings (#643).
  test("an attributed tag must come back with its attribute text verbatim; a void tag needs no close (#590)", () => {
    const source =
      'Read the <a href="%s" target="_blank">docs</a>.<br>Then go.';
    expect(
      validateTranslation(
        source,
        'Lê a <a href="%s" target="_blank">documentação</a>.<br/>Depois vai.',
        "pt",
        "android",
      ),
    ).toEqual({ ok: true });
    expect(
      errorsOf(
        source,
        'Lê a <a href="%s">documentação</a>.<br>',
        "pt",
        "android",
      ),
    ).toEqual([
      { code: "missing-tag", name: 'a href="%s" target="_blank"' },
      { code: "unexpected-tag", name: 'a href="%s"' },
    ]);
    expect(
      errorsOf(
        source,
        'Lê a <a href="%s" target="_blank">documentação</a>.',
        "pt",
        "android",
      ),
    ).toEqual([{ code: "missing-tag", name: "br" }]);
  });

  const SOURCE = "Received {code} from <url></url>. See the <link>docs</link>.";
  test("every tag must survive, wherever it moves; none may be added", () => {
    expect(
      validateTranslation(
        SOURCE,
        "<link>Docs</link>: <url></url> answered {code}.",
      ),
    ).toEqual({ ok: true });
    expect(errorsOf(SOURCE, "Received {code} from <url></url>.")).toEqual([
      { code: "missing-tag", name: "link" },
    ]);
    expect(errorsOf("Plain {code}", "<b>{code}</b>")).toEqual([
      { code: "unexpected-tag", name: "b" },
    ]);
    expect(
      validateTranslation(
        "{g, select, m {<b>he</b>} other {they}}",
        "<b>{g, select, m {he} other {they}}</b>",
      ),
    ).toEqual({ ok: true });
  });

  test("<br> is void only where the text is HTML; elsewhere <br></br> is a pair and a lone <br> is unclosed (#643)", () => {
    const pair = "Scroll<br></br>to zoom";
    expect(
      validateTranslation(pair, "Desliza<br></br>para ampliar", "pt"),
    ).toEqual({ ok: true });
    const lone = validateTranslation(pair, "Desliza<br>para ampliar", "pt");
    expect(lone.ok).toBe(false);
    expect(!lone.ok && lone.errors[0]).toMatchObject({
      code: "invalid-icu",
      where: "target",
      message: "unclosed <br>",
    });
    expect(
      validateTranslation(pair, "Desliza<br>para ampliar", "pt", "icu", {
        richText: "html",
      }),
    ).toEqual({ ok: true });
    // Android strings are HTML: a lone <br> is void there.
    expect(validateTranslation("A<br>B", "C<br/>D", "de", "android")).toEqual({
      ok: true,
    });
    // react-i18next's Trans keeps br void and reads <br></br> as one br:
    // under i18next both forms hold.
    expect(
      validateTranslation(pair, "Desliza<br>para ampliar", "pt", "i18next"),
    ).toEqual({ ok: true });
    expect(
      validateTranslation("A<br>B", "C<br></br>D", "pt", "i18next"),
    ).toEqual({
      ok: true,
    });
  });

  test("under richText html a translation's tags need not match the source's; placeholders and parsing still hold (#622)", () => {
    const html = { richText: "html" } as const;
    const source = "Logged in as {user} on {host}.";
    expect(
      validateTranslation(
        source,
        "Kevreet evel <i>{user}</i> war {host}.<br/><br/>",
        "br",
        "icu",
        html,
      ),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(
        "Read the <b>docs</b>",
        "Lê a documentação",
        "pt",
        "icu",
        html,
      ),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(
        source,
        "Kevreet evel <i>{user}</i>.",
        "br",
        "icu",
        html,
      ),
    ).toEqual({
      ok: false,
      errors: [{ code: "missing-placeholder", name: "host" }],
    });
    const unclosed = validateTranslation(
      source,
      "<i>{user} {host}",
      "br",
      "icu",
      html,
    );
    // A tag that never closes is text in HTML, as a browser reads it
    // (#755): the translation is valid.
    expect(unclosed.ok).toBe(true);
    expect(errorsOf(source, "<i>{user}</i> {host}")).toEqual([
      { code: "unexpected-tag", name: "i" },
    ]);
  });
});

describe("android library", () => {
  test("a verb in a tag's attribute takes its place in the argument order, as getString formats it before fromHtml (#956)", () => {
    const de = (source: string, target: string) =>
      validateTranslation(source, target, "de", "android");
    const link = '<a href="%s">%s</a>';
    expect(de(link, link)).toEqual({ ok: true });
    expect(de(link, '<a href="%1$s">%2$s</a>')).toEqual({ ok: true });
    expect(de(link, '<a href="%s">%s</a> (%2$s)')).toEqual({ ok: true });
    // The link's text would show the URL.
    expect(de(link, '<a href="%s">%1$s</a>')).toMatchObject({ ok: false });
    expect(de('<a href="%s">x</a>', '<a href="%d">x</a>')).toMatchObject({
      ok: false,
    });
    expect(
      de('<a href="%1$s">x</a> %2$s', '<a href="">x</a> %2$s'),
    ).toMatchObject({ ok: false });
    // Two tags that read alike are two arguments.
    const two = '<a href="%s">x</a> <a href="%s">y</a>';
    expect(de(two, '<a href="%2$s">y</a> <a href="%1$s">x</a>')).toEqual({
      ok: true,
    });
    expect(de(two, '<a href="%1$s">y</a> <a href="%1$s">x</a>')).toMatchObject({
      ok: false,
    });
    // Which of two alike tags wraps the text is the position's.
    expect(
      de(
        '<a href="%s">x</a><a href="%s"></a>',
        '<a href="%1$s">x</a><a href="%2$s"></a>',
      ),
    ).toEqual({ ok: true });
    expect(
      de(
        '<a href="%s">x</a><a href="%s"></a>',
        '<a href="%1$s">x</a><a href="%2$s"/>',
      ),
    ).toEqual({ ok: true });
    expect(
      de(
        '<a href="%1$s">x</a><a href="%2$s"></a>',
        '<a href="%s"></a><a href="%s">x</a>',
      ),
    ).toMatchObject({ ok: false, errors: [{ code: "unpaired-tag" }] });
    // A chip inserts the source's tag as written.
    expect(partsOf(link, "android").tags).toEqual(new Set(['a href="%s"']));
  });

  test("a dropped verb, a changed verb and an added tag are named; a plural keeps its verbs per branch (#596)", () => {
    const source = "Logged in as %1$s on %2$s.";
    expect(errorsOf(source, "Kevreet evel %1$s.", "br", "android")).toEqual([
      { code: "missing-placeholder", name: "2", written: "%2$s" },
    ]);
    expect(
      errorsOf(source, "Kevreet evel <i>%1$s</i> war %2$s.", "br", "android"),
    ).toEqual([{ code: "unexpected-tag", name: "i" }]);
    expect(
      validateTranslation(
        "{quantity, plural, one {%d episode} other {%d episodes}}",
        "{quantity, plural, one {%d episódio} many {%d episódios} other {%d episódios}}",
        "pt",
        "android",
      ),
    ).toEqual({ ok: true });
    expect(
      errorsOf(
        "{quantity, plural, one {%d episode} other {%d episodes}}",
        "{quantity, plural, one {%s episódio} many {%d episódios} other {%d episódios}}",
        "pt",
        "android",
      ),
    ).toMatchObject([
      { code: "changed-verb", expected: "%d", actual: "%s", indexed: "%n$s" },
    ]);
    // Each item numbers its own verbs, so position 1 may be %s in one
    // and %d in another; a translation identical to the source, or one
    // with only `other`, is valid (#632 review).
    const mixed =
      "{quantity, plural, one {One episode in %s} other {%d episodes in %s}}";
    expect(validateTranslation(mixed, mixed, "en", "android")).toEqual({
      ok: true,
    });
    expect(
      validateTranslation(
        mixed,
        "{quantity, plural, other {%d 個のエピソード（%s）}}",
        "ja",
        "android",
      ),
    ).toEqual({ ok: true });
  });
});

describe("chrome library", () => {
  test("a dropped $NAME$ is named as written; its case and place are the translator's (#595)", () => {
    const source = "Copied $CURRENT$ of $TOTAL$";
    expect(
      validateTranslation(
        source,
        "$total$: $Current$ copiados",
        "pt",
        "chrome",
      ),
    ).toEqual({ ok: true });
    expect(errorsOf(source, "Copiados $CURRENT$", "pt", "chrome")).toEqual([
      { code: "missing-placeholder", name: "total", written: "$TOTAL$" },
    ]);
    expect(errorsOf("Copy", "Copiar $ITEM$", "pt", "chrome")).toEqual([
      { code: "unexpected-placeholder", name: "item", written: "$ITEM$" },
    ]);
  });
});

describe("i18next syntax", () => {
  test("a placeholder must survive, spaces inside the braces or not; a single brace is text", () => {
    expect(
      validateTranslation(
        "{{ count }} documents starred",
        "{{count}} documentos marcados",
        undefined,
        "i18next",
      ),
    ).toEqual({ ok: true });
    expect(
      errorsOf(
        "{{ count }} documents starred",
        "documentos marcados",
        undefined,
        "i18next",
      ),
    ).toEqual([{ code: "missing-placeholder", name: "count" }]);
    expect(
      validateTranslation(
        "Press {enter}",
        "Prima {enter}",
        undefined,
        "i18next",
      ),
    ).toEqual({ ok: true });
  });
});

test("an =1 branch is the one category where one holds only 1; not in French, where it holds 0 and 1 (#650)", () => {
  const source = "{n, plural, =1 {Profile} other {Profiles}}";
  for (const language of ["de", "nl", "es", "it", "ca", "tr", "en"]) {
    const result = validateTranslation(
      source,
      "{n, plural, =1 {Profil} other {Profile}}",
      language,
    );
    expect(result.ok).toBe(true);
    const incomplete = "incomplete" in result ? (result.incomplete ?? []) : [];
    expect(incomplete).not.toContainEqual(
      expect.objectContaining({ key: "one" }),
    );
  }
  expect(
    validateTranslation(
      source,
      "{n, plural, =1 {Profil} other {Profils}}",
      "fr",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: expect.arrayContaining([
      { code: "missing-category", arg: "n", key: "one" },
    ]),
  });
  // Russian's one is 1, 21, 31…: =1 does not cover it.
  expect(
    validateTranslation(
      source,
      "{n, plural, =1 {a} few {b} many {c} other {d}}",
      "ru",
    ),
  ).toMatchObject({
    incomplete: [{ code: "missing-category", arg: "n", key: "one" }],
  });
  // Arabic's and Welsh's zero is 0 alone; Brazilian Portuguese's one
  // holds 0 and 1, Portugal's 1 alone.
  for (const language of ["ar", "cy"])
    expect(
      validateTranslation(
        "{n, plural, other {x}}",
        "{n, plural, =0 {a} one {b} two {c} few {d} many {e} other {f}}",
        language,
      ),
    ).not.toHaveProperty("incomplete");
  expect(
    validateTranslation(
      source,
      "{n, plural, =1 {a} many {b} other {c}}",
      "pt-PT",
    ),
  ).not.toHaveProperty("incomplete");
  expect(
    validateTranslation(source, "{n, plural, =1 {a} many {b} other {c}}", "pt"),
  ).toMatchObject({ incomplete: [{ key: "one" }] });
  // A key the runtimes match as written: =01 is not =1.
  expect(
    validateTranslation(source, "{n, plural, =01 {a} other {b}}", "de"),
  ).toMatchObject({ incomplete: [{ key: "one" }] });
  // Unbounded categories are never covered by a list of =N.
  expect(
    validateTranslation(
      source,
      "{n, plural, =1 {a} =2 {b} =5 {c} other {d}}",
      "pl",
    ),
  ).toMatchObject({
    incomplete: [
      { code: "missing-category", arg: "n", key: "few" },
      { code: "missing-category", arg: "n", key: "many" },
    ],
  });
  // Spanish's many is a million and up, which no count below a million
  // reaches: it is allowed, not asked for (#997).
  expect(
    validateTranslation(source, "{n, plural, =1 {a} other {b}}", "es"),
  ).toEqual({ ok: true });
});

test("an other-only language may write a plural as the plain text of its other branch (#651)", () => {
  const source = "{count, plural, one {# post} other {# posts}}";
  expect(validateTranslation(source, "{count}件の投稿", "ja")).toEqual({
    ok: true,
  });
  // The other branch's values must survive: # is the count.
  expect(validateTranslation(source, "投稿", "ja")).toEqual({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
  // An other branch without # needs no count.
  expect(
    validateTranslation(
      "{count, plural, one {One post by {name}} other {Posts by {name}}}",
      "{name}の投稿",
      "ko",
    ),
  ).toEqual({ ok: true });
  // A dead one branch in Japanese is a warning.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {# 件} other {# 件}}",
      "ja",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "unexpected-category", arg: "count", key: "one" }],
  });
  // A language with categories writing a count the source never prints
  // as one text loses no value, but reads one form for every count
  // (#992).
  expect(
    validateTranslation(
      "{count, plural, one {One post by {name}} other {Posts by {name}}}",
      "Beiträge von {name}",
      "de",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "flattened-plural", arg: "count" }],
  });
  // Not on Android: a <string> in values-zh is not the <plurals> the
  // code asks for, and Chinese users would get the default's text.
  expect(
    validateTranslation(
      "{quantity, plural, one {%d episode} other {%d episodes}}",
      "%d 集",
      "zh",
      "android",
    ),
  ).toMatchObject({ ok: false });
});

test("under printf a text that is one ICU plural has its verbs checked per branch (#652)", () => {
  const source = "{count, plural, one {%d card} other {%d cards}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d Karte} other {%d Karten}}",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  // Joplin's draft: stray verbs in a branch are refused.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {Karte} other {Karten %s %x}}",
      "de",
      "printf",
    ),
  ).toMatchObject({ ok: false });
  // The plural is checked too: a category German does not use is a warning.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d Karte} few {%d Karten} other {%d Karten}}",
      "de",
      "printf",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "unexpected-category", arg: "count", key: "few" }],
  });
  // Tags and # stay text under printf.
  expect(
    validateTranslation(
      "{n, plural, one {<b>#</b> %lld post} other {<b>#</b> %lld posts}}",
      "{n, plural, one {<i>#</i> %lld Beitrag} other {<i>#</i> %lld Beiträge}}",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  // Anything that is not one plural from end to end, or does not parse
  // as one, is printf text as before.
  for (const text of [
    "{n, plural, one {a} other {b}} and {c}",
    "{n, plural, one {a}}",
    "{user.count, plural, one {a} other {b}}",
  ])
    expect(parseIcu(text, "printf")).toEqual({
      ok: true,
      nodes: [{ kind: "literal", text }],
    });
  // A translation that opens as the plural but is not one says why.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d Karte}}",
      "de",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-other", arg: "count" }],
  });
  expect(
    validateTranslation(
      source,
      "{count, plural, other {%d枚}} x",
      "ja",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", where: "target" }],
  });
  // A plain translation of a plural is told to write the plural.
  expect(validateTranslation(source, "%d Karten", "de", "printf")).toEqual({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
  // A printf text that is not wholly a plural keeps its braces as text.
  expect(
    validateTranslation("Hello {name} %s", "Olá {nome} %s", "pt", "printf"),
  ).toEqual({ ok: true });
});

test("a placeholder named in any script is a placeholder, so a translated name is missing and unexpected (#653)", () => {
  expect(
    validateTranslation("Uploaded {time}", "อัปโหลดเมื่อ {เวลา}", "th"),
  ).toEqual({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "time" },
      { code: "unexpected-placeholder", name: "เวลา" },
    ],
  });
  expect(validateTranslation("{count} items", "{đếm} mục", "vi")).toEqual({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "count" },
      { code: "unexpected-placeholder", name: "đếm" },
    ],
  });
  // A source may name them so too, and a translation keeps them.
  expect(
    validateTranslation("こんにちは {名前}", "Hello {名前}", "en"),
  ).toEqual({
    ok: true,
  });
  // vue-i18n's compiler takes ASCII names only, and shows a message with
  // another raw (#1017).
  expect(
    validateTranslation("Hi {name}", "Привет {наме}", "ru", "vue"),
  ).toMatchObject({ ok: false, errors: [{ code: "invalid-icu" }] });
  expect(
    validateTranslation("Hi {{name}}", "Olá {{nome_é}}", "pt", "i18next"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder" },
      { code: "unexpected-placeholder", name: "nome_é" },
    ],
  });
});

test("under i18next a text that is one plural, as a plural object reads, has its placeholders checked per form (#662)", () => {
  const source =
    "{count, plural, one {{{count}} room} other {{{count}} rooms}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, one {{{count}} pokój} few {{{count}} pokoje} many {{{count}} pokoi} other {{{count}} pokoju}}",
      "pl",
      "i18next",
    ),
  ).toEqual({ ok: true });
  // A form that leaves out the number is fine: the plural is the count.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {Ein Raum} other {{{count}} Räume}}",
      "de",
      "i18next",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, one {{{count}} Raum} other {{{n}} Räume}}",
      "de",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "unexpected-placeholder", name: "n" }],
  });
  // # is text under i18next, as the forms were written.
  expect(
    validateTranslation(
      "{count, plural, one {#1 pick} other {#{{count}} picks}}",
      "{count, plural, one {#1 Wahl} other {#{{count}} Wahlen}}",
      "de",
      "i18next",
    ),
  ).toEqual({ ok: true });
  // Plain i18next text with braces is as before.
  expect(
    validateTranslation("Hi {{name}} {x}", "Olá {{name}} {x}", "pt", "i18next"),
  ).toEqual({ ok: true });
});

test("under counterpart %(name)s is a placeholder and a bare <tag> a substitution (#663)", () => {
  const lib = "counterpart" as const;
  // Element's export_chat: a draft that drops %(count)s is refused.
  expect(
    validateTranslation(
      "Fetched %(count)s events out of %(total)s",
      "Pobrano zdarzenia z %(total)s",
      "pl",
      lib,
    ),
  ).toEqual({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "count", written: "%(count)s" },
    ],
  });
  // A bare <pill> needs no close; a pair is a pair; braces are text.
  expect(
    validateTranslation(
      "Invite <pill> to {room} as <b>admin</b>, %(count)d times",
      "Zaproś <pill> do {pokój} jako <b>admin</b>, %(count)d razy",
      "pl",
      lib,
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("Invite <pill>", "Zaproś", "pl", lib),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag", name: "pill" }],
  });
  // The letter is part of the placeholder: Element substitutes %(n)s.
  expect(validateTranslation("%(n)s left", "%(n)d zostało", "pl", lib)).toEqual(
    {
      ok: false,
      errors: [
        { code: "missing-placeholder", name: "n", written: "%(n)s" },
        { code: "unexpected-placeholder", name: "n", written: "%(n)d" },
      ],
    },
  );
  // A plural object read as one string, its forms counterpart's, whose
  // English rule never picks few or many (#951).
  expect(
    validateTranslation(
      "{count, plural, one {%(count)s room} other {%(count)s rooms}}",
      "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi} other {%(count)s pokoju}}",
      "pl",
      lib,
    ),
  ).toEqual({
    ok: true,
    incomplete: [
      { code: "unexpected-category", arg: "count", key: "few" },
      { code: "unexpected-category", arg: "count", key: "many" },
    ],
  });
});

test("under easy_localization {} is positional, {name} named, and a link must be kept (#664)", () => {
  const lib = "easy_localization" as const;
  expect(
    validateTranslation(
      "Hello {}, you have {} files",
      "Hallo {}, du hast {} Dateien",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("Hello {}, you have {} files", "Hallo {}", "de", lib),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", written: "{}" }],
  });
  expect(validateTranslation("Hi {name}", "Hallo {name}", "de", lib)).toEqual({
    ok: true,
  });
  // AppFlowy: a draft that drops @:appName is refused.
  expect(
    validateTranslation("Your @:appName account", "Dein Konto", "de", lib),
  ).toEqual({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "@:appName", written: "@:appName" },
    ],
  });
  expect(
    validateTranslation(
      "@.upper:appName ready",
      "@.upper:appName bereit",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
  // A plural object read whole: {} in a form is the count.
  expect(
    validateTranslation(
      "{count, plural, one {{} file} other {{} files}}",
      "{count, plural, one {{} Datei} other {{} Dateien}}",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
  // Braces around text and angle brackets are text.
  expect(validateTranslation("a {b c} <d>", "x {b c} <d>", "de", lib)).toEqual({
    ok: true,
  });
  // A nested link is one link; the sentence's dot is not its key's.
  expect(
    validateTranslation(
      "See @:chat.changeFormat.bullet.",
      "Siehe @:chat.changeFormat.numbr.",
      "de",
      lib,
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "@:chat.changeFormat.bullet" },
      { code: "unexpected-placeholder", name: "@:chat.changeFormat.numbr" },
    ],
  });
  expect(
    validateTranslation("Open @:appName.", "Öffne @:appName.", "de", lib),
  ).toEqual({ ok: true });
});

test("under rails %{name} is a placeholder, %%{ a literal, braces text (#665)", () => {
  const lib = "rails" as const;
  // Discourse: a draft writing {application_name} breaks at runtime.
  expect(
    validateTranslation(
      "Welcome to %{application_name}",
      "Willkommen bei {application_name}",
      "de",
      lib,
    ),
  ).toEqual({
    ok: false,
    errors: [
      {
        code: "missing-placeholder",
        name: "application_name",
        written: "%{application_name}",
      },
    ],
  });
  expect(
    validateTranslation(
      "Type %%{name} for {curly} and <b>%{count}</b> %",
      "Tippe %%{name} für {curly} und <b>%{count}</b> %",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
  // Rails' format style is a placeholder, and %% is always a pair.
  expect(
    validateTranslation(
      "Total: %<count>d items, %<amount>.2f due, 100%%%{pct}",
      "Summe: %<count>d, %<amount>.2f fällig, 100%%%{pct}",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
  expect(validateTranslation("100%%%{pct}", "100%%", "de", lib)).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", written: "%{pct}" }],
  });
  expect(
    validateTranslation(
      "{count, plural, one {%{count} post} other {%{count} posts}}",
      "{count, plural, one {%{count} Beitrag} other {%{count} Beiträge}}",
      "de",
      lib,
    ),
  ).toEqual({ ok: true });
});

test("under qt %1–%99, %L1 and %n are placeholders by number; any other % and <dir> are text (#666)", () => {
  const lib = "qt" as const;
  // Time formats: %1h %2m are two placeholders, not printf verbs.
  expect(validateTranslation("%1h %2m", "%1 ч %2 мин", "ru", lib)).toEqual({
    ok: true,
  });
  // A correct Arabic %1 before a letter is saved; a dropped %1 refused.
  expect(validateTranslation("%1 s", "%1 ث", "ar", lib)).toEqual({ ok: true });
  expect(
    validateTranslation("Moved %1 to %2", "Déplacé vers %2", "fr", lib),
  ).toEqual({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "1", written: "%1" }],
  });
  // `% 1` and `1%` are not %1.
  expect(
    validateTranslation("%1 files", "% 1 Dateien", "de", lib),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "1" }],
  });
  // Order is free, numbers may repeat, %L1 is %1 localised, %n the count.
  expect(
    validateTranslation("%1 of %2 (%1)", "%2 中的 %L1 (%1)", "zh", lib),
  ).toEqual({ ok: true });
  expect(validateTranslation("%n file(s)", "%n Datei(en)", "de", lib)).toEqual({
    ok: true,
  });
  // Qt reads %0 and %01 too: %01 is %1, and a stray %0 is a placeholder.
  expect(validateTranslation("%1 left", "%01 übrig", "de", lib)).toEqual({
    ok: true,
  });
  expect(
    validateTranslation("%1 left", "%0 %1 übrig", "de", lib),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "unexpected-placeholder", name: "0" }],
  });
  // 100% and <dir> are text; so are braces.
  expect(
    validateTranslation("100% of <dir> {x}", "100% von <dir> {x}", "de", lib),
  ).toEqual({ ok: true });
});

// Ice Cubes' `timeline.n-recent-from-n-participants %lld %lld`, as the
// xcstrings reader writes a String Catalog's substitutions (#726).
const RECENT =
  "{arg1, plural, one {%arg recent post} other {%arg recent posts}} from {arg2, plural, one {%arg participant} other {%arg participants}}";

test("printf reads plurals on argN among its text, %arg the argument itself (#726)", () => {
  const parsed = parseIcu(RECENT, "printf");
  expect(parsed.ok && parsed.nodes.map((n) => n.kind)).toEqual([
    "plural",
    "literal",
    "plural",
  ]);
  expect(validateTranslation(RECENT, RECENT, "en", "printf")).toEqual({
    ok: true,
  });
  // German's names differ in the file; read by argument they agree.
  expect(
    validateTranslation(
      RECENT,
      "{arg1, plural, one {%arg aktueller Beitrag} other {%arg aktuelle Beiträge}} von {arg2, plural, one {%arg Teilnehmendem} other {%arg Teilnehmenden}}",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  // Polish joins them with a space and adds few.
  expect(
    validateTranslation(
      RECENT,
      "{arg1, plural, one {%arg ostatni post} few {%arg ostatnie posty} many {%arg ostatnich postów} other {%arg ostatnich postów}} {arg2, plural, one {od %arg uczestnika} few {od %arg uczestników} many {od %arg uczestników} other {od %arg uczestników}}",
      "pl",
      "printf",
    ),
  ).toEqual({ ok: true });
  // Dropping an argument is still missing.
  expect(
    validateTranslation(
      RECENT,
      "{arg1, plural, one {%arg Beitrag} other {%arg Beiträge}}",
      "de",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "2" }],
  });
});

test("a translation may pluralise an argument the source prints plainly, and write one it pluralises plainly (#726)", () => {
  const source = "%@ boosted %lld posts";
  expect(
    validateTranslation(
      source,
      "%@ hat {arg2, plural, one {%arg Beitrag} other {%arg Beiträge}} geteilt",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      "{arg1, plural, one {%arg post} other {%arg posts}} from %@",
      "%lld Beiträge von %@",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  // A positional verb beside a plural keeps its place.
  expect(
    validateTranslation(
      "%2$@: {arg1, plural, one {%arg post} other {%arg posts}}",
      "{arg1, plural, one {%arg Beitrag} other {%arg Beiträge}} — %2$@",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  // A verb of another type beside the plural is still a changed verb.
  expect(
    validateTranslation(
      "{arg1, plural, one {%arg post} other {%arg posts}} from %@",
      "{arg1, plural, one {%arg Beitrag} other {%arg Beiträge}} von %lld",
      "de",
      "printf",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "changed-verb", name: "2" }] });
});

test("%arg is never the hex-float verb, and a brace in other printf text stays text (#726)", () => {
  const parsed = parseIcu("{arg1, plural, other {%arg}}", "printf");
  expect(parsed).toEqual({
    ok: true,
    nodes: [
      {
        kind: "plural",
        arg: "arg1",
        branches: {
          other: [{ kind: "placeholder", name: "1", written: "%arg" }],
        },
      },
    ],
  });
  expect(parseIcu("{count} %@ {x, plural, other {y}} tail", "printf")).toEqual({
    ok: true,
    nodes: [
      { kind: "literal", text: "{count} " },
      { kind: "placeholder", name: "1", written: "%@" },
      { kind: "literal", text: " {x, plural, other {y}} tail" },
    ],
  });
});

test("an unindexed verb in a substitution's branch is its argument, as Basque writes %lld (#726)", () => {
  expect(
    validateTranslation(
      RECENT,
      "{arg2, plural, one {Partaide batek egindako} other {%lld partaidek egindako}} {arg1, plural, one {bidalketa %lld} other {%lld bidalketa}}",
      "eu",
      "printf",
    ),
  ).toEqual({ ok: true });
});

test("in a substitution's branch only the first unindexed verb is the argument; a draft on argN parses; %a is not %arg (#726)", () => {
  const cards = "{arg1, plural, one {%d card in %@} other {%d cards in %@}}";
  expect(
    validateTranslation(
      cards,
      "{arg1, plural, one {%d Karte} other {%d Karten}}",
      "de",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "2" }],
  });
  expect(
    validateTranslation(
      cards,
      "{arg1, plural, one {%@: %d Karte} other {%@: %d Karten}}",
      "de",
      "printf",
    ).ok,
  ).toBe(false);
  // The editor's plural chip writes the source's own name.
  const parsed = parseIcu(RECENT, "printf");
  expect(
    parsed.ok &&
      parsed.nodes.flatMap((n) => (n.kind === "plural" ? [n.arg] : [])),
  ).toEqual(["arg1", "arg2"]);
  // `%arg` outside a branch is printf's hex float, `%a`.
  expect(
    validateTranslation(
      "{arg1, plural, one {%arg post} other {%arg posts}} from %@",
      "%arg Beiträge von %@",
      "de",
      "printf",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "changed-verb", name: "1" }] });
  expect(
    partsOf(
      "{arg1, plural, one {%arg post} other {%lld posts}}",
      "printf",
    ).written.get("1"),
  ).toBe("%lld");
});

test("the arguments a key passes are values a translation may pluralise or print, of the key's type (#731)", () => {
  const favourite = { arguments: ["%lld"] };
  // English prints none of it; German pluralises on it.
  expect(
    validateTranslation(
      "starred",
      "{arg1, plural, one {hat favorisiert} other {haben favorisiert}}",
      "de",
      "printf",
      favourite,
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("starred", "%lld Sterne", "de", "printf", favourite),
  ).toEqual({ ok: true });
  // Of the key's type: %@ is not an lld count.
  expect(
    validateTranslation("starred", "%@ Sterne", "de", "printf", favourite),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "changed-verb", name: "1", expected: "%lld" }],
  });
  // Beyond the key's arguments is still unknown.
  expect(
    validateTranslation(
      "starred",
      "{arg2, plural, one {a} other {b}}",
      "de",
      "printf",
      favourite,
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "unknown-plural" }] });
  // A plain verb where the source's substitution has only %arg takes the
  // key's type.
  expect(
    validateTranslation(
      "{arg1, plural, one {%arg post} other {%arg posts}}",
      "%@ Beiträge",
      "de",
      "printf",
      favourite,
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "changed-verb", name: "1" }] });
  expect(
    validateTranslation(
      "{arg1, plural, one {%arg post} other {%arg posts}}",
      "%lld Beiträge",
      "de",
      "printf",
      favourite,
    ),
  ).toEqual({ ok: true });
});

test("the key's type applies where the text writes no verb of its own (#731)", () => {
  // The text's own %lld decides; the key's %@ does not loosen it.
  expect(
    validateTranslation("%lld stars", "%@ Sterne", "de", "printf", {
      arguments: ["%@"],
    }).ok,
  ).toBe(false);
});

test("in a type read as HTML a tag that never closes, or a stray closing tag, is text (#755)", () => {
  const head = "HTML to insert at the end of the <head> of each page";
  expect(parseIcu(head, "rails", { html: "markup" }).ok).toBe(true);
  expect(parseIcu(head, "rails", { html: true }).ok).toBe(false);
  expect(
    validateTranslation(
      head,
      "HTML a inserir no fim do <head> de cada página",
      "pt",
      "rails",
      { richText: "html" },
    ),
  ).toEqual({ ok: true });
  // An unclosed <p> as browsers accept it, and a stray </b>.
  const prose = parseIcu("<p>One<p>Two</b>", "icu", { html: "markup" });
  expect(prose.ok && prose.nodes.every((n) => n.kind === "literal")).toBe(true);
  expect(
    prose.ok &&
      prose.nodes.map((n) => (n.kind === "literal" ? n.text : "")).join(""),
  ).toBe("<p>One<p>Two</b>");
  // A tag that does close is still a tag.
  expect(
    parseIcu("a <b>bold</b> word", "icu", { html: "markup" }),
  ).toMatchObject({
    ok: true,
    nodes: [
      { kind: "literal", text: "a " },
      { kind: "tag", name: "b" },
      { kind: "literal", text: " word" },
    ],
  });
  // A component-rendered type still refuses an unclosed tag.
  expect(
    validateTranslation("a <b>bold</b>", "a <b>bold", "pt", "icu").ok,
  ).toBe(false);
});

test("reading prose tags is one pass: a thousand unclosed tags, verbs counted once, slots read from such a text (#755)", () => {
  const started = Date.now();
  expect(parseIcu("<a>".repeat(1000), "icu", { html: "markup" }).ok).toBe(true);
  expect(
    parseIcu(
      `{n, plural, one {${"<a>".repeat(40)}} other {${"</a>".repeat(40)}}}`,
      "icu",
      { html: "markup" },
    ).ok,
  ).toBe(true);
  expect(
    parseIcu("<a>".repeat(40) + "</a x>".repeat(40), "icu", { html: "markup" })
      .ok,
  ).toBe(true);
  expect(Date.now() - started).toBeLessThan(1000);
  expect(
    validateTranslation(
      "Hello %s, you have %d",
      "<b>Olá %s, tens %d",
      "pt",
      "android",
      { richText: "html" },
    ),
  ).toEqual({ ok: true });
  expect(
    partsOf("<p><span>%{username}</span> %{description}", "rails").placeholders,
  ).toEqual(new Set(["username", "description"]));
  expect(
    renderPreview("Insert <head> {name}", { name: "x" }, "en"),
  ).toMatchObject({ ok: true, text: "Insert <head> x" });
});

test("a nested message is validated at both levels (#764)", () => {
  const source =
    "{g, select, female {{n, plural, one {She has # file} other {She has # files}}} other {{n, plural, one {They have # file} other {They have # files}}}}";
  const inner = (one: string, few: string, other: string) =>
    `{n, plural, one {${one}} few {${few}} many {${other}} other {${other}}}`;
  expect(
    validateTranslation(
      source,
      `{g, select, female {${inner("Ona ma # plik", "Ona ma # pliki", "Ona ma # plików")}} other {${inner("Mają # plik", "Mają # pliki", "Mają # plików")}}}`,
      "pl",
    ),
  ).toEqual({ ok: true });
  // The inner plural's categories are the target language's.
  expect(
    validateTranslation(
      source,
      "{g, select, female {{n, plural, one {Ona ma # plik} other {Ona ma # plików}}} other {{n, plural, one {Mają # plik} other {Mają # plików}}}}",
      "pl",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [
      { code: "missing-category", arg: "n", key: "few" },
      { code: "missing-category", arg: "n", key: "many" },
    ],
  });
  // The outer select's branches are the source's; the count is kept.
  expect(
    validateTranslation(
      source,
      "{g, select, other {{n, plural, one {Tem ficheiro} other {Tem ficheiros}}}}",
      "pt-PT",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-branch", arg: "g", key: "female" }],
  });
  // A select in a plural's branch, the inner select's keys checked.
  expect(
    validateTranslation(
      "{n, plural, one {{g, select, female {her file} other {their file}}} other {# files}}",
      "{n, plural, one {{g, select, male {o ficheiro dele} other {o ficheiro}}} other {# ficheiros}}",
      "pt-PT",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-branch", arg: "g", key: "female" },
      { code: "unexpected-branch", arg: "g", key: "male" },
    ],
  });
  // A translation nests as its source does: a plural's forms written
  // back as Android items or a plural object would lose one turned
  // inside out.
  expect(
    validateTranslation(
      source,
      "{n, plural, one {{g, select, female {Ela tem {n} ficheiro} other {Têm {n} ficheiro}}} other {{g, select, female {Ela tem {n} ficheiros} other {Têm {n} ficheiros}}}}",
      "en",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "changed-nesting", outer: "n", inner: "g" }],
  });
  // `#` in a select within a plural: text to FormatJS, the count to
  // messageformat.js.
  const inPlural =
    "{n, plural, one {{g, select, female {her file} other {their file}}} other {{n} files}}";
  expect(
    validateTranslation(
      inPlural,
      "{n, plural, one {{g, select, female {# ficheiro dela} other {# ficheiro}}} other {{n} ficheiros}}",
      "en",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "nested-count", arg: "n" }] });
  expect(
    validateTranslation(
      inPlural,
      "{n, plural, one {{g, select, female {{n} ficheiro dela} other {{n} ficheiro}}} other {{n} ficheiros}}",
      "en",
    ),
  ).toEqual({ ok: true });
});

test("a translation that is its source's own text keeps the source's # warning, not an error (#923)", () => {
  const source =
    "{n, plural, one {{g, select, a {# x} other {y}}} other {{g, select, a {# xs} other {ys}}}}";
  expect(validateTranslation(source, source, "en")).toEqual({ ok: true });
  // Any other text writing # there is still the translator's, refused.
  expect(
    validateTranslation(source, source.replace("# x}", "# z}"), "en"),
  ).toMatchObject({ ok: false, errors: [{ code: "nested-count", arg: "n" }] });
  // The source's text restructured, as a TMS fills a target file, is the
  // source's own text too (#1009).
  expect(
    validateTranslation(
      `Hi ${source}`,
      "{n, plural, one {{g, select, a {Hi # x} other {Hi y}}} other {{g, select, a {Hi # xs} other {Hi ys}}}}",
      "en",
    ),
  ).toEqual({ ok: true });
});

test("nestedCountsOf names the plurals whose # sits in a select within them (#767)", () => {
  expect(
    nestedCountsOf(
      "{n, plural, one {{g, select, f {# x} other {y}}} other {z}}",
    ),
  ).toEqual(["n"]);
  expect(
    nestedCountsOf(
      "{n, plural, one {{g, select, f {{n} x} other {y}}} other {z}}",
    ),
  ).toEqual([]);
  expect(
    nestedCountsOf(
      "{g, select, f {{n, plural, one {# x} other {# y}}} other {z}}",
    ),
  ).toEqual([]);
  expect(nestedCountsOf("{n, plural, one {# {")).toEqual([]);
});

test("a branch named __proto__ is a branch a translation must keep (#846)", () => {
  const source = "{g, select, __proto__ {P} other {O}}";
  expect(validateTranslation(source, source).ok).toBe(true);
  const result = validateTranslation(source, "{g, select, other {O}}");
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors).toContainEqual({
    code: "missing-branch",
    arg: "g",
    key: "__proto__",
  });
});

test("in a type read as HTML a tag's attribute placeholders are kept apart from the text's (#948)", () => {
  const html = { richText: "html" as const };
  const source =
    "<a href='%{userUrl}'>%{user}</a> posted <a href='%{topicUrl}'>the topic</a>";
  const pt = (target: string, lib: Library = "rails", src = source) =>
    validateTranslation(src, target, "pt", lib, html);
  expect(
    pt("<a href='%{userUrl}'>%{user}</a> publicou <a href='#'>o tópico</a>"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "topicUrl", written: "%{topicUrl}" },
    ],
  });
  expect(
    pt(
      "<a href='%{userUrl}'>%{user}</a> publicou <a href='%{topicUrl}'>o tópico</a>",
    ),
  ).toEqual({ ok: true });
  // A name in both places stays in both.
  const both = "<a href='/u/%{username}'>%{username}</a> replied";
  expect(
    pt("<a href='/u/%{username}'>alguém</a> respondeu", "rails", both),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "username" }],
  });
  expect(
    pt(
      "<1 href='{{u}}'>alguém</1> entrou",
      "i18next",
      "<1 href='{{u}}'>{{u}}</1> joined",
    ),
  ).toMatchObject({ ok: false });
  // A tag read as prose, unclosed, still carries its attribute's.
  const open = "<a href='%{u}'>link</a> %{n}";
  expect(pt("<a href='%{u}'>ligação %{n}", "rails", open)).toEqual({
    ok: true,
  });
  expect(pt("ligação %{n}", "rails", "<a href='%{u}'>link %{n}")).toMatchObject(
    { ok: false, errors: [{ code: "missing-placeholder", name: "u" }] },
  );
  expect(pt("<a href='%{v}'>ligação</a> %{n}", "rails", open)).toMatchObject({
    ok: false,
  });
  // Elsewhere the attribute text is the tag's identity: one error, the tag.
  expect(
    validateTranslation(
      "<a href='{url}'>{name}</a>",
      "<a href='#'>{name}</a>",
      "pt",
      "icu",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag" }, { code: "unexpected-tag" }],
  });
  expect(partsOf(source, "rails").placeholders).toEqual(new Set(["user"]));
});

test("a rails %{ that closes no placeholder is refused, %%{ is text (#948)", () => {
  for (const broken of [
    "Baada ya %{dana] siku",
    "Imechapishwa na %{jina la mtumiaji}",
    "Đăng bởi %{{username} ngày %{post_date}",
    "<a title='%{jina la}'>x</a>",
  ]) {
    expect(parseIcu(broken, "rails").ok, broken).toBe(false);
  }
  expect(parseIcu("Escrever %%{nome} à letra", "rails")).toMatchObject({
    ok: true,
    nodes: [{ kind: "literal" }],
  });
  expect(partsOf("Olá %{name}", "rails").placeholders).toEqual(
    new Set(["name"]),
  );
});

test("outside ICU a count the source prints is printed by some form of the translation (#949)", () => {
  const element =
    "{count, plural, one {Fetched %(count)s event out of %(total)s} other {Fetched %(count)s events out of %(total)s}}";
  expect(
    validateTranslation(
      element,
      "{count, plural, one {Pobrano zdarzenie z %(total)s} few {Pobrano zdarzenia z %(total)s} many {Pobrano zdarzeń z %(total)s} other {Pobrano zdarzeń z %(total)s}}",
      "pl",
      "counterpart",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "count", written: "%(count)s" },
    ],
  });
  expect(
    validateTranslation(
      element,
      "{count, plural, one {Pobrano zdarzenie z %(total)s} few {Pobrano %(count)s zdarzenia z %(total)s} many {Pobrano %(count)s zdarzeń z %(total)s} other {Pobrano %(count)s zdarzeń z %(total)s}}",
      "pl",
      "counterpart",
    ),
  ).toMatchObject({ ok: true });
  // Discourse's Hebrew: every form a fixed word.
  expect(
    validateTranslation(
      "{count, plural, one {%{count} reply} other {%{count} replies}}",
      "{count, plural, one {תגובה} two {שתי תגובות} other {שתי תגובות}}",
      "he",
      "rails",
    ),
  ).toMatchObject({ ok: false });
  expect(
    validateTranslation(
      "{count, plural, one {{{count}} item} other {{{count}} items}}",
      "{count, plural, other {アイテム}}",
      "ja",
      "i18next",
    ),
  ).toMatchObject({ ok: false });
  // ICU's `#` prints the count, so a form may leave it out.
  expect(
    validateTranslation(
      "{count, plural, one {{count} item} other {{count} items}}",
      "{count, plural, one {um item} other {# itens}}",
      "pt",
    ),
  ).toMatchObject({ ok: true });
});

test("a whole plural without other is named for it, under i18next too (#950)", () => {
  for (const [lib, count] of [
    ["i18next", "{{count}}"],
    ["counterpart", "%(count)s"],
    ["rails", "%{count}"],
  ] as const)
    expect(
      validateTranslation(
        `{count, plural, one {${count} thing} other {${count} things}}`,
        `{count, plural, one {${count} rzecz} few {${count} rzeczy}}`,
        "pl",
        lib,
      ),
      lib,
    ).toMatchObject({
      ok: false,
      errors: [{ code: "missing-other", arg: "count" }],
    });
});

test("a plural's categories are its library's rule: counterpart's English one, easy_localization's by value, CLDR's elsewhere (#951)", () => {
  const counterpart =
    "{count, plural, one {%(count)s room} other {%(count)s rooms}}";
  // Element's Polish: one and other, as counterpart picks in every language.
  expect(
    validateTranslation(
      counterpart,
      "{count, plural, one {%(count)s pokój} other {%(count)s pokoi}}",
      "pl",
      "counterpart",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      counterpart,
      "{count, plural, zero {Brak} one {%(count)s pokój} few {%(count)s pokoje} other {%(count)s pokoi}}",
      "pl",
      "counterpart",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "unexpected-category", key: "few" }],
  });
  // Japanese keeps one, which counterpart picks for 1.
  expect(
    validateTranslation(
      counterpart,
      "{count, plural, other {%(count)s 部屋}}",
      "ja",
      "counterpart",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "missing-category", key: "one" }],
  });
  const easy = "{count, plural, zero {No rows} one {{} row} other {{} rows}}";
  expect(
    validateTranslation(
      easy,
      "{count, plural, zero {Brak} one {{} wiersz} other {{} wierszy}}",
      "pl",
      "easy_localization",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      easy,
      "{count, plural, one {{} wiersz} few {{} wiersze} other {{} wierszy}}",
      "pl",
      "easy_localization",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "unexpected-category", key: "few" }],
  });
  expect(
    validateTranslation(
      easy,
      "{count, plural, zero {لا} one {{} صف} other {{} صفوف}}",
      "ar",
      "easy_localization",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "missing-category", key: "two" }],
  });
  // Value 1 reads a Japanese `one` where written, so it is no dead text.
  expect(
    validateTranslation(
      easy,
      "{count, plural, one {{} 行} other {{} 行}}",
      "ja",
      "easy_localization",
    ),
  ).toEqual({ ok: true });
  // counterpart's rule is English's whatever the tag, one it has no data
  // for too.
  expect(
    validateTranslation(
      counterpart,
      "{count, plural, other {%(count)s qach}}",
      "tlh",
      "counterpart",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "missing-category", key: "one" }],
  });
  // CLDR's elsewhere, as before.
  expect(
    validateTranslation(
      "{count, plural, one {%{count} room} other {%{count} rooms}}",
      "{count, plural, one {%{count} pokój} other {%{count} pokoi}}",
      "pl",
      "rails",
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [
      { code: "missing-category", key: "few" },
      { code: "missing-category", key: "many" },
    ],
  });
});

test("a gettext file's Plural-Forms, where given, are the categories a plural needs; CLDR's others are allowed (#951)", () => {
  const source = "{count, plural, one {%d file} other {%d files}}";
  const it = "{count, plural, one {%d file} other {%d file}}";
  // Italian's many is for millions alone: not asked for (#997).
  expect(validateTranslation(source, it, "it", "printf")).toEqual({
    ok: true,
  });
  expect(
    validateTranslation(source, it, "it", "printf", {
      pluralForms: ["one", "other"],
    }),
  ).toEqual({ ok: true });
  // A tag the runtime has no plural data for enforces nothing, whatever
  // categories came with it.
  expect(
    validateTranslation(source, it, "oc", "printf", {
      pluralForms: ["one", "many"],
    }),
  ).toEqual({ ok: true });
  // A form the file holds none of is text it cannot write (#973).
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d file} many {%d file} other {%d file}}",
      "it",
      "printf",
      { pluralForms: ["one", "other"] },
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "unexpected-category", key: "many" }],
  });
});

test("a gettext file's own =N keys are its plural's branches; a category it holds no form for is said (#982)", () => {
  const source = "{count, plural, one {%d file} other {%d files}}";
  const ceb = { pluralForms: ["=1", "other"] };
  expect(
    validateTranslation(
      source,
      "{count, plural, =1 {%d A} other {%d B}}",
      "ceb",
      "printf",
      ceb,
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d A} other {%d B}}",
      "ceb",
      "printf",
      ceb,
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [
      { code: "missing-category", key: "=1" },
      { code: "unexpected-category", key: "one" },
    ],
  });
  // Hebrew's many, which CLDR dropped, where the file gives it a form.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%d a} two {%d b} many {%d c} other {%d d}}",
      "he",
      "printf",
      { pluralForms: ["one", "two", "many", "other"] },
    ),
  ).toEqual({ ok: true });
});

test("under rails, zero is never a branch the runtime does not pick; rails-i18n's keys, where given, are the ones needed (#983)", () => {
  const source = "{count, plural, one {%{count} file} other {%{count} files}}";
  for (const language of ["pt-BR", "de", "ja"])
    expect(
      validateTranslation(
        source,
        "{count, plural, zero {none} one {%{count} x} other {%{count} y}}",
        language,
        "rails",
      ).incomplete?.filter(
        (e) => e.code === "unexpected-category" && e.key === "zero",
      ) ?? [],
      language,
    ).toEqual([]);
  // fr under rails-i18n's OneUptoTwoOther: no many needed.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%{count} f} other {%{count} fs}}",
      "fr",
      "rails",
      { pluralForms: ["one", "other"] },
    ),
  ).toEqual({ ok: true });
  // ja under Other: one is dead.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%{count} a} other {%{count} b}}",
      "ja",
      "rails",
      { pluralForms: ["other"] },
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "unexpected-category", key: "one" }],
  });
  // I18n's own one and other, for a locale rails-i18n has no rule for:
  // Burmese may write one, and needs it, as I18n without fallbacks
  // raises for 1 where a hash lacks it.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {%{count} a} other {%{count} b}}",
      "my",
      "rails",
      { pluralForms: ["one", "other"] },
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, other {%{count} b}}",
      "my",
      "rails",
      {
        pluralForms: ["one", "other"],
      },
    ),
  ).toMatchObject({
    ok: true,
    incomplete: [{ code: "missing-category", key: "one" }],
  });
  // Another library's zero stays CLDR's verdict.
  expect(
    validateTranslation(
      "{count, plural, one {# file} other {# files}}",
      "{count, plural, zero {none} one {# x} other {# y}}",
      "de",
      "icu",
    ),
  ).toMatchObject({
    incomplete: [{ code: "unexpected-category", key: "zero" }],
  });
});

test("under i18next, zero is a branch in every language, as i18next picks _zero for 0 (#985)", () => {
  const source =
    "{count, plural, one {{{count}} call} other {{{count}} calls}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, zero {Keine} one {{{count}} Anruf} other {{{count}} Anrufe}}",
      "de",
      "i18next",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, one {{{count}} x} few {{{count}} y} other {{{count}} z}}",
      "pl",
      "i18next",
    ),
  ).toMatchObject({ incomplete: [{ code: "missing-category", key: "many" }] });
});

test("in a language whose only category is other, a value only another source branch prints is not missed (#985)", () => {
  const source =
    '{count, plural, one {Delete "{{name}}"?} other {Delete {{count}} variables?}}';
  expect(
    validateTranslation(
      source,
      "{count, plural, other {{{count}}件の変数を削除しますか？}}",
      "ja",
      "i18next",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, other {削除しますか？}}",
      "ja",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
  // German has one: there it is needed.
  expect(
    validateTranslation(
      source,
      "{count, plural, one {Löschen?} other {{{count}} löschen?}}",
      "de",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name" }],
  });
});

test("a value only a source branch the library never picks prints is not missed, and one it picks is, whatever CLDR says (#985 review)", () => {
  const icu =
    '{count, plural, =1 {Delete "{name}"?} one {Delete "{name}"?} other {Delete # items?}}';
  // ICU in Japanese: =1 is always picked, so its {name} is needed.
  expect(
    validateTranslation(
      icu,
      "{count, plural, other {#件を削除しますか？}}",
      "ja",
      "icu",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name" }],
  });
  // counterpart picks one for 1 in every language, Japanese included.
  const cp =
    "{count, plural, one {Delete %(name)s?} other {Delete %(count)s items?}}";
  expect(
    validateTranslation(
      cp,
      "{count, plural, other {%(count)s件を削除}}",
      "ja",
      "counterpart",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name" }],
  });
  // printf under a gettext file that picks one and other.
  const pf = "{count, plural, one {Delete %s?} other {Delete %d items?}}";
  expect(
    validateTranslation(
      pf,
      "{count, plural, one {%s?} other {%d件}}",
      "ja",
      "printf",
      {
        pluralForms: ["one", "other"],
      },
    ),
  ).toEqual({ ok: true });
});

test("a tag with no plural data needs every branch's values, under i18next and rails too (#985 review)", () => {
  for (const [library, name] of [
    ["i18next", "{{name}}"],
    ["rails", "%{name}"],
  ] as const) {
    const source =
      `{count, plural, one {Delete ${name}?} other {Delete {count} items?}}`.replace(
        "{count} items",
        library === "i18next" ? "{{count}} items" : "%{count} items",
      );
    const target = `{count, plural, one {x} other {${library === "i18next" ? "{{count}}" : "%{count}"} y}}`;
    expect(
      validateTranslation(source, target, "kz", library),
      library,
    ).toMatchObject({
      ok: false,
      errors: [{ code: "missing-placeholder" }],
    });
  }
});

test("under i18next an unpaired tag is prose, a pair still a tag, and a pair closed on itself wraps nothing (#986)", () => {
  const prose = 'List of "<GroupID>:<OrgIdOrName>:<Role>" mappings.';
  expect(validateTranslation(prose, prose, "fr", "i18next")).toEqual({
    ok: true,
  });
  expect(
    validateTranslation("<no title>", "<sans titre>", "fr", "i18next"),
  ).toEqual({
    ok: true,
  });
  expect(
    validateTranslation(
      "See <0>the docs</0>",
      "Voir la documentation",
      "fr",
      "i18next",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "missing-tag", name: "0" }] });
  expect(
    validateTranslation(
      "See <2>the docs</2>.",
      "请参阅<2>文档<2/>。",
      "zh-Hans",
      "i18next",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "unpaired-tag", name: "2" }] });
  // ICU's components still refuse an unclosed tag.
  expect(
    validateTranslation("<no title>", "<sans titre>", "fr", "icu"),
  ).toMatchObject({
    ok: false,
  });
});

test("under i18next a translation's broken tag is still found: a close it adds, an open the source's pair lacks its close; a source's own stray close may be kept (#986 review)", () => {
  const bad = (source: string, target: string) =>
    validateTranslation(source, target, "cs", "i18next");
  expect(
    bad(
      "The setting <strong>{{s}}</strong> is set",
      "Nastavení <strong>{{s}}</strong> <strong>je",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", message: "unclosed <strong>" }],
  });
  expect(bad("Removed by {{user_by}}", "</em> {{user_by}} <em>")).toMatchObject(
    {
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-icu",
          message: "unexpected </em>",
        }),
      ]),
    },
  );
  expect(bad("See <0>docs</0>", "Voir <0>docs</0> <0>")).toMatchObject({
    ok: false,
  });
  expect(
    bad("Restart. </br> Then enable.", "Restartujte. </br> Pak povolte."),
  ).toEqual({
    ok: true,
  });
  // A placeholder in a prose tag's attribute is the text's.
  expect(bad('Click <a href="{{url}}">here', "Klikněte zde")).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "url" }],
  });
});

test("a pair that wraps nothing may be written closed on itself (#986 review)", () => {
  expect(
    validateTranslation("Line<br></br>two", "Ligne<br/>deux", "fr", "icu"),
  ).toEqual({
    ok: true,
  });
  expect(validateTranslation("A <x></x> b", "A <x/> b", "fr", "icu")).toEqual({
    ok: true,
  });
  expect(
    validateTranslation("A <1></1> b", "A <1/> b", "fr", "i18next"),
  ).toEqual({
    ok: true,
  });
});

test("under i18next a translation's unclosed HTML element is broken markup, however the source reads, and the source's own unclosed tag may be mirrored (#986 review)", () => {
  expect(
    validateTranslation(
      "You may use:\n - `[name]`",
      "Brug:\n <ul> <li> [navn]",
      "da",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: expect.arrayContaining([
      expect.objectContaining({
        code: "invalid-icu",
        message: "unclosed <ul>",
      }),
    ]),
  });
  const email = "<h1>Welcome</h1><p>Hi [name].<p>Bye";
  expect(
    validateTranslation(
      email,
      "<h1>Hola</h1><p>Hola [name].<p>Adiós",
      "es",
      "i18next",
    ),
  ).toEqual({
    ok: true,
  });
});

test("an i18next plural's branches are read for prose tags each on its own; prose that starts with an element's name is prose (#986 review 2)", () => {
  const plural = "{count, plural, one {1 file} other {{{count}} files}}";
  expect(
    validateTranslation(
      plural,
      "{count, plural, one {1 arquivo </em>} other {{{count}} arquivos <li>}}",
      "pt",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: expect.arrayContaining([
      expect.objectContaining({ message: "unexpected </em>" }),
      expect.objectContaining({ message: "unclosed <li>" }),
    ]),
  });
  // The source's own stray </br>, mirrored in each branch.
  const stray =
    "{count, plural, one {{{count}} file.</br>} other {{{count}} files.</br>}}";
  expect(
    validateTranslation(
      stray,
      "{count, plural, one {1 arquivo.</br>} other {{{count}} arquivos.</BR>}}",
      "pt",
      "i18next",
    ),
  ).toMatchObject({ ok: true });
  for (const [language, text] of [
    ["pt", "<em andamento>"],
    ["es", "<a definir>"],
    ["cs", "<s přílohami>"],
  ] as const)
    expect(
      validateTranslation("<in progress>", text, language, "i18next"),
      text,
    ).toEqual({
      ok: true,
    });
  expect(
    validateTranslation(
      "<in progress>",
      '<a href="x">em andamento',
      "pt",
      "i18next",
    ),
  ).toMatchObject({ ok: false });
  expect(
    validateTranslation("You may use:", "<li / >Можете:", "uk", "i18next"),
  ).toMatchObject({ ok: false });
  // A value moved out of a prose attribute into the text is said once.
  const moved = validateTranslation(
    'Click <a href="{{url}}">here',
    "Clique {{url}}",
    "pt",
    "i18next",
  );
  expect(moved.ok).toBe(false);
  if (!moved.ok)
    expect(
      moved.errors.filter((e) => "name" in e && e.name === "url"),
    ).toHaveLength(1);
  // Nine unclosed <p> beside an emptied pair: the pair once, the rest broken.
  const many = validateTranslation(
    "<p>Hello</p>",
    "<p></p><p>a<p>b",
    "ro",
    "i18next",
  );
  expect(many.ok).toBe(false);
  if (!many.ok)
    expect(many.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(["unpaired-tag", "invalid-icu"]),
    );
});

test("each target branch may keep the prose tags the source's branches do, however many branches the language has (#986 review 3)", () => {
  const source =
    "{count, plural, one {1 file </br> ok} other {{{count}} files </br> ok}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, one {1 plik </br> ok} few {{{count}} pliki </br> ok} many {{{count}} plików </br> ok} other {{{count}} pliku </br> ok}}",
      "pl",
      "i18next",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, plural, one {1 plik </br> x </br> ok} few {{{count}} pliki ok} many {{{count}} plików ok} other {{{count}} pliku ok}}",
      "pl",
      "i18next",
    ),
  ).toMatchObject({ ok: false });
});

test("a prose tag in a place the source keeps none in may be as many as one place of the source keeps (#986 review 4)", () => {
  const source =
    "{count, plural, one {1 file </br> ok} other {{{count}} files </br> ok}}";
  expect(
    validateTranslation(source, "{{count}} ファイル </br> ok", "ja", "i18next"),
  ).toEqual({
    ok: true,
  });
  expect(
    validateTranslation(
      "Restart. </br> {{count}} files",
      "{count, plural, one {Restart. </br> 1 plik} few {Restart. </br> {{count}} pliki} many {Restart. </br> {{count}} plików} other {Restart. </br> {{count}} pliku}}",
      "pl",
      "i18next",
    ),
  ).toMatchObject({ ok: true });
});

test("under android an unpaired tag is prose, as only an escape or CDATA writes one, and a pair is still compared (#987)", () => {
  expect(
    validateTranslation(
      "<Unknown Recipient>",
      "<Destinataire inconnu>",
      "fr",
      "android",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("<b>Bold</b> text", "Texte gras", "fr", "android"),
  ).toMatchObject({ ok: false, errors: [{ code: "missing-tag", name: "b" }] });
});

test("under android a prose tag's printf verb counts in its place (#987 review)", () => {
  const source = "<Unknown %s> sent %d";
  expect(
    validateTranslation(source, "<Inconnu %s> envoyé %d", "fr", "android"),
  ).toEqual({
    ok: true,
  });
  expect(
    validateTranslation(source, "%d envoyé", "fr", "android"),
  ).toMatchObject({ ok: false });
  expect(
    validateTranslation("<Unknown %s>", "<Inconnu>", "fr", "android"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder" }],
  });
});

test("a Rails key ending _html is read as HTML: its tags the translation's own, but closed as the source closes them (#988)", () => {
  expect(richTextFor("server", "about.hint_html", "rails", undefined)).toBe(
    "html-key",
  );
  expect(richTextFor("server", "about.html", "rails", undefined)).toBe(
    "html-key",
  );
  expect(
    richTextFor("server", "about.hint_html", "i18next", undefined),
  ).toBeUndefined();
  expect(richTextFor("server", "about.hint", "rails", { server: "html" })).toBe(
    "html",
  );
  expect(
    richTextFor("server", "about.hint_html", "rails", { server: "html" }),
  ).toBe("html-key");
  expect(richTextFor("server", "ns:html", "rails", undefined)).toBe("html-key");
  expect(richTextFor("server", "foo-html", "rails", undefined)).toBe(
    "html-key",
  );
  expect(richTextFor("server", "foohtml", "rails", undefined)).toBeUndefined();
  const key = { richText: "html-key" as const };
  const source = 'Read <strong>this</strong> and <a href="%{path}">that</a>.';
  const v = (target: string) =>
    validateTranslation(source, target, "pt", "rails", key);
  expect(v('Leia <em>isto</em> e <a href="%{path}">aquilo</a>.')).toEqual({
    ok: true,
  });
  expect(v('Leia isto e <a href="%{path}">aquilo</a>.')).toEqual({ ok: true });
  // uk's `< /a>`: the link never closes.
  expect(
    v('Leia <strong>isto</strong> e <a href="%{path}">aquilo< /a>.'),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", message: "unclosed <a>" }],
  });
  // ia's missing quote swallows the rest.
  expect(
    v('Leia <strong>isto</strong> e <a href="%{path}>aquilo</a>.'),
  ).toMatchObject({
    ok: false,
    errors: [expect.objectContaining({ code: "invalid-icu" })],
  });
  // A value moved out of the attribute into the text is said once.
  const moved = v("Leia <strong>isto</strong> e aquilo %{path}.");
  expect(moved.ok).toBe(false);
  if (!moved.ok)
    expect(
      moved.errors.filter((e) => "name" in e && e.name === "path"),
    ).toHaveLength(1);
  // A link emptied of its text still hides it.
  expect(
    v('Leia <strong>isto</strong> e aquilo <a href="%{path}"></a>.'),
  ).toMatchObject({
    ok: false,
    errors: [expect.objectContaining({ code: "unpaired-tag" })],
  });
  // A plain key still compares its tags.
  expect(
    validateTranslation(
      "Read <strong>this</strong>",
      "Leia isto",
      "pt",
      "rails",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag", name: "strong" }],
  });
});

test("in an _html key a quote inside a quoted value is no open quote, and #948's attribute placeholder still counts (#988 review)", () => {
  const key = { richText: "html-key" as const };
  expect(
    validateTranslation(
      'See <abbr title="summer">it</abbr> <a href="%{path}">help</a>',
      '<abbr title="l\'été">ça</abbr> <a href="%{path}" title="l\'aide">aide</a>',
      "fr",
      "rails",
      key,
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      "<nom d'utilisateur>",
      "<nom d'utilisateur> ici",
      "fr",
      "rails",
      key,
    ),
  ).toEqual({ ok: true });
  // #948: an attribute's value printed only in the text is still missing from the attribute.
  expect(
    validateTranslation('<a href="{url}">{url}</a>', "{url}", "fr", "icu", {
      richText: "html",
    }),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "url" }],
  });
});

test("a plural whose count the source never prints is a selector: writing it as one text misses no value, and is incomplete where the language inflects (#992)", () => {
  const source =
    "{count, plural, one {card from the deck} other {cards from the deck}}";
  expect(validateTranslation(source, "kort fra kortsættet", "da")).toEqual({
    ok: true,
    incomplete: [{ code: "flattened-plural", arg: "count" }],
  });
  // One category: nothing to vary.
  expect(validateTranslation(source, "デッキのカード", "ja")).toEqual({
    ok: true,
  });
  // No plural data: checked for its shape, so still incomplete.
  expect(validateTranslation(source, "cartae", "la")).toEqual({
    ok: true,
    incomplete: [{ code: "flattened-plural", arg: "count" }],
  });
  // A `#` in a select within the plural prints the count.
  const nested = validateTranslation(
    "{count, plural, one {{g, select, f {# carta} other {# card}}} other {{g, select, f {# cartas} other {# cards}}}}",
    "kort",
    "da",
  );
  expect(nested.ok ? [] : nested.errors).toEqual([
    expect.objectContaining({ code: "missing-placeholder", name: "count" }),
  ]);
  // A count the source prints is still a value to keep.
  const printed = validateTranslation(
    "{count, plural, one {# card} other {# cards}}",
    "karty",
    "pl",
  );
  expect(printed.ok ? [] : printed.errors).toEqual([
    expect.objectContaining({ code: "missing-placeholder", name: "count" }),
  ]);
  const outside = validateTranslation(
    "{count} {count, plural, one {card} other {cards}}",
    "karty",
    "pl",
  );
  expect(outside.ok ? [] : outside.errors).toEqual([
    expect.objectContaining({ code: "missing-placeholder", name: "count" }),
  ]);
  // Fluent's sources select on a count they never print, as Anki's do.
  expect(
    validateTranslation(source, "kort fra kortsættet", "da", "fluent"),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "flattened-plural", arg: "count" }],
  });
});

test("a plural written plainly may print its own count; a language of the source's base needs the source's own categories (#1005)", () => {
  // Immich: the runtime passes count, so a one-category text may print it.
  expect(
    validateTranslation(
      "Permanently delete {count, plural, one {asset} other {assets}}",
      "永久刪除 {count} 個項目",
      "yue-Hant",
    ),
  ).toEqual({ ok: true });
  // A value the source never has is still unexpected.
  const other = validateTranslation(
    "Permanently delete {count, plural, one {asset} other {assets}}",
    "永久刪除 {total} 個項目",
    "yue-Hant",
  );
  expect(other.ok ? [] : other.errors).toEqual([
    expect.objectContaining({ code: "unexpected-placeholder", name: "total" }),
  ]);
  // en-GB copies an other-only English source: the author decided the
  // text does not vary.
  const delayed = "{jobCount, plural, other {# delayed}}";
  expect(
    validateTranslation(delayed, delayed, "en-GB", "icu", {
      sourceLanguage: "en",
    }),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(delayed, delayed, "en_GB", "icu", {
      sourceLanguage: "en-US",
    }),
  ).toEqual({ ok: true });
  // Nor does it flatten anything written as plain text.
  expect(
    validateTranslation(
      "{jobCount, plural, other {delayed}}",
      "delayed",
      "en-GB",
      "icu",
      { sourceLanguage: "en" },
    ),
  ).toEqual({ ok: true });
  // Another language keeps CLDR's.
  expect(
    validateTranslation(
      delayed,
      "{jobCount, plural, other {# retrasados}}",
      "es",
      "icu",
      {
        sourceLanguage: "en",
      },
    ),
  ).toMatchObject({
    ok: true,
    incomplete: expect.arrayContaining([
      { code: "missing-category", arg: "jobCount", key: "one" },
    ]),
  });
  // A source with one and other still needs one in en-GB.
  expect(
    validateTranslation(
      "{n, plural, one {# job} other {# jobs}}",
      "{n, plural, other {# jobs}}",
      "en-GB",
      "icu",
      { sourceLanguage: "en" },
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "n", key: "one" }],
  });
  // A plural on a value the source lacks is still unknown.
  const unknown = validateTranslation(
    "{counter} you know",
    "{count, plural, one {# знаеш} other {# знаеце}}",
    "be",
  );
  expect(unknown.ok ? [] : unknown.errors.map((e) => e.code)).toContain(
    "unknown-plural",
  );
});

test("Qt: a marker no .arg() fills is text; %n in a numerus message is its count; a lookalike percent is refused (#1003)", () => {
  const qt = (source: string, target: string, language = "tr") =>
    validateTranslation(source, target, language, "qt");
  // KeePassXC: tr() with no .arg, Turkish percentages.
  expect(
    qt(
      "More than 10% of passwords are reused.",
      "Parolaların %10'undan fazlası yeniden kullanılıyor.",
    ),
  ).toEqual({ ok: true });
  // Transmission: .arg() fills %1 alone, so %100 (%10, then 0) is text.
  expect(qt("%1 (100%)", "%1 (%100)")).toEqual({ ok: true });
  // A marker writing no number the source writes is Qt's `%1` as text,
  // still named.
  const stray = qt("Purged %n icon(s).", "Poistettu %1 kuvaketta.", "fi");
  expect(stray.ok ? [] : stray.errors.map((e) => e.code)).toEqual([
    "missing-placeholder",
    "unexpected-placeholder",
  ]);
  // A source with its own %n keeps every marker it prints.
  const own = qt(
    "{count, plural, other {and%1 %Ln leecher(s)%2 %3 ago}}",
    "{count, plural, other {en%1 %Ln saaier(s)%2 gelede}}",
    "af",
  );
  expect(own.ok ? [] : own.errors.map((e) => e.code)).toEqual([
    "missing-placeholder",
  ]);
  // A stray marker .arg() would fill, where %1 is lost, is still said.
  const lost = qt("%1 (100%)", "%10 (yüzde)");
  expect(lost.ok ? [] : lost.errors.map((e) => e.code)).toEqual([
    "missing-placeholder",
    "unexpected-placeholder",
  ]);
  // KeePassXC et: translate() fills %n in a numerus message.
  expect(
    qt(
      "{count, plural, other {over %1 year(s)}}",
      "{count, plural, one {Üle %n aasta} other {Üle %n aasta}}",
      "et",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "count-for-marker", name: "1", written: "%1" }],
  });
  // With two markers, %n where one was is no count's place: the name is
  // lost, or lands where the count belongs.
  const leaked =
    "{count, plural, other {Password for '%1' has been leaked %2 time(s)!}}";
  expect(
    qt(leaked, "{count, plural, other {Salasana on vuotanut %n kertaa!}}", "fi")
      .ok,
  ).toBe(false);
  expect(
    qt(
      leaked,
      "{count, plural, other {Salasana '%n' on vuotanut %2 kertaa!}}",
      "fi",
    ).ok,
  ).toBe(false);
  // A lookalike before a number the source has no marker for is text.
  expect(qt("50% done", "٪50 مكتمل", "ar")).toEqual({ ok: true });
  expect(qt("%1 done", "٪ 1 مكتمل", "ar").ok).toBe(false);
  // ar: U+066A before n is no marker at all.
  const ar = qt(
    "{count, plural, other {%n row(s)}}",
    "{count, plural, zero {٪n صف} one {%n صف} two {%n صف} few {%n صفوف} many {%n صفًا} other {%n صف}}",
    "ar",
  );
  expect(ar.ok ? [] : ar.errors).toEqual([
    expect.objectContaining({
      code: "invalid-icu",
      where: "target",
      message: "writes ٪n, which Qt prints as text; write %n",
    }),
  ]);
});

test("under printf a Python mapping key, %(name)s, is a placeholder named by its key, its conversion kept (#1012)", () => {
  expect(
    validateTranslation(
      "Organization type: %(organization_type)s",
      "Typ: %(typ)s",
      "cs",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        code: "missing-placeholder",
        name: "organization_type",
        written: "%(organization_type)s",
      },
      { code: "unexpected-placeholder", name: "typ" },
    ],
  });
  expect(
    validateTranslation(
      "%(n).1f MB of %(total)s",
      "%(total)s: %(n).1f MB",
      "de",
      "printf",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("%(n)d files", "%(n)s Dateien", "de", "printf"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "changed-verb", name: "n", expected: "%(n)d", actual: "%(n)s" },
    ],
  });
  // The space flag stays out, as for a verb: prose, not a key.
  expect([...partsOf("50%(approx) of", "printf").placeholders]).toEqual([]);
  // A C verb beside it counts on by position as before.
  expect([...partsOf("%(a)s %s %d", "printf").placeholders]).toEqual([
    "a",
    "1",
    "2",
  ]);
  // A key is found by its name: one that changed conversion did not
  // move, and needs no index.
  expect(
    validateTranslation("%(a)s, %(b)d", "%(b)s, %(a)s", "de", "printf"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "changed-verb", name: "b", moved: false }],
  });
});

test("under vue a placeholder name and an @ follow vue-i18n's own compiler (#1017)", () => {
  // A hyphen is a name; a script other than ASCII is no name, and one
  // error says so, with no missing and unexpected pair.
  expect(
    validateTranslation("Use a {local-mta}", "Nutze {local-mta}", "de", "vue"),
  ).toEqual({ ok: true });
  for (const target of ["Va {aquí}", "{০} আগে", "{الإخطار}"]) {
    const result = validateTranslation("Go {here}", target, "es", "vue");
    expect(result).toMatchObject({
      ok: false,
      errors: [
        {
          code: "invalid-icu",
          where: "target",
          message: expect.stringMatching(
            /is not a name vue-i18n compiles \(a–z, digits, _, \$, -\); the whole message shows raw/,
          ),
        },
      ],
    });
    if (!result.ok) expect(result.errors).toHaveLength(1);
  }
  // An @ opening no link does not compile; a link and {'@'} do.
  for (const target of ["Hallo @all", "mail a@b.c", "x @ y"])
    expect(
      validateTranslation("Hi {'@'}all", target, "de", "vue"),
    ).toMatchObject({ ok: false, errors: [{ code: "bare-at" }] });
  for (const target of [
    "Hallo {'@'}all",
    "@:common.name",
    "@.upper:foo",
    "@:(foo)",
    "@:{'foo'}",
  ])
    expect(validateTranslation("Hi {'@'}all", target, "de", "vue").ok).toBe(
      true,
    );
  // The source's own text keeps the source's warning (#923).
  expect(validateTranslation("mail a@b.c", "mail a@b.c", "de", "vue")).toEqual({
    ok: true,
  });
  expect(bareAtOf("mail a@b.c", "vue")).toBe(true);
  expect(bareAtOf("mail {'@'} @:x", "vue")).toBe(false);
  expect(bareAtOf("mail a@b.c", "icu")).toBe(false);
  // A quoted brace is no brace: the @ after it is text, as the compiler
  // reads it, and an @ quoted with a brace is quoted.
  expect(bareAtOf("{'{'} \"@context\": 1 {'}'}", "vue")).toBe(true);
  expect(bareAtOf("{'{'}@all", "vue")).toBe(true);
  expect(bareAtOf("{'}@'}", "vue")).toBe(false);
  // Modifiers as the compiler names them, and a key that starts with a
  // dot is empty.
  expect(bareAtOf("@.snake_case:k @.upper2:k @._x:k", "vue")).toBe(false);
  expect(bareAtOf("@:.a", "vue")).toBe(true);
  // ICU keeps any script's names.
  expect(
    validateTranslation("こんにちは {名前}", "Hello {名前}", "en").ok,
  ).toBe(true);
});

test("a tag's attributes compare as HTML reads them, spacing, quotes, order and a URL's edge spaces aside (#1022)", () => {
  const source = 'See <a href="x" target="_blank">it</a>';
  for (const target of [
    'Vois <a href = "x"  target="_blank" >ça</a>',
    "Vois <a href='x' target='_blank'>ça</a>",
    'Vois <a href="x " target="_blank">ça</a>',
    'Vois <a target="_blank" href="x">ça</a>',
    'Vois <a HREF="x" target="_blank">ça</a>',
  ])
    expect(validateTranslation(source, target, "fr", "counterpart")).toEqual({
      ok: true,
    });
  for (const target of [
    'Vois <a href="x#a b" target="_blank">ça</a>',
    'Vois <a href="mailto :x" target="_blank">ça</a>',
    'Vois <a href="x" target=" _blank">ça</a>',
  ])
    expect(validateTranslation(source, target, "fr", "counterpart").ok).toBe(
      false,
    );
  // A missing tag is said in the source's own spelling.
  expect(
    validateTranslation(source, "Vois ça", "fr", "counterpart"),
  ).toMatchObject({
    errors: [{ code: "missing-tag", name: 'a href="x" target="_blank"' }],
  });
});

test("a placeholder moved out of a broken tag into the text is said once, as moved (#1022)", () => {
  const result = validateTranslation(
    '<a href="%{path}">Go</a>',
    '<href="%{path}">Vai</a>',
    "ckb",
    "rails",
    { richText: "html" },
  );
  expect(result).toMatchObject({ ok: false });
  if (result.ok) return;
  expect(result.errors.filter((e) => e.code.endsWith("placeholder"))).toEqual([
    {
      code: "moved-placeholder",
      name: "path",
      written: "%{path}",
      tag: 'a href="%{path}"',
    },
  ]);
  // ICU's and i18next's too, which keep no written form.
  for (const [syntax, src, tgt, tag] of [
    [
      "icu",
      '<a href="{url}">Go</a>',
      '<href="{url}">Vai</a>',
      'a href="{url}"',
    ],
    [
      "i18next",
      '<a href="{{url}}">Go</a>',
      '<href="{{url}}">Vai</a>',
      'a href="{{url}}"',
    ],
  ] as const) {
    const moved = validateTranslation(src, tgt, "fr", syntax, {
      richText: "html",
    });
    if (moved.ok) throw new Error(`${syntax} moved ok`);
    expect(moved.errors.filter((e) => e.code.endsWith("placeholder"))).toEqual([
      expect.objectContaining({ code: "moved-placeholder", name: "url", tag }),
    ]);
  }
});

test("an attribute text HTML reads otherwise, a quote dropped or one stray, is compared as written (#1022)", () => {
  for (const [syntax, src, tgt] of [
    ["icu", '<a href="x">a</a>', '<a href=x">b</a>'],
    ["rails", '<a href="%{p}">a</a>', '<a href=%{p}">b</a>'],
    ["counterpart", '<a href="%(u)s">a</a>', '<a href=%(u)s">b</a>'],
    ["icu", '<a href="x">a</a>', "<a href=x'>b</a>"],
    ["icu", '<a href="x">a</a>', '<a href="x"">b</a>'],
    [
      "icu",
      '<a href="x" target="_blank">a</a>',
      '<a href="x" " target="_blank">b</a>',
    ],
    ["icu", '<a href="x">a</a>', '<a href="x" ===>b</a>'],
  ] as const)
    expect(validateTranslation(src, tgt, "fr", syntax).ok).toBe(false);
  // A Rails `_html` key's link emptied is said, its spacing aside.
  expect(
    validateTranslation(
      '<a href="x">link</a>',
      '<a href = "x"></a>',
      "fr",
      "rails",
      {
        richText: "html-key",
      },
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "unpaired-tag" }] });
});

test("a placeholder in a tag's attribute list is one token, compared by name and never lowercased (#1022)", () => {
  // Relay's `{ $attrs }`, read through fluent as `{attrs}`.
  expect(
    validateTranslation(
      '<a href="{x}" {attrs}>x</a>',
      '<a href = "{x}" {attrs}>y</a>',
      "cy",
      "icu",
    ),
  ).toEqual({ ok: true });
  for (const target of [
    '<a href="{x}" {Attrs}>y</a>',
    '<a href="{x}" {ATTRS}>y</a>',
  ])
    expect(
      validateTranslation('<a href="{x}" {attrs}>x</a>', target, "cy", "icu")
        .ok,
    ).toBe(false);
});

test("a placeholder an apostrophe quotes is missing, and the error says the apostrophe did it (#1010)", () => {
  expect(
    validateTranslation("Open {name}", "Ouvrir l'{name}", "fr", "formatjs"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name", quoted: true }],
  });
  expect(
    validateTranslation("Open {name}", "Ouvrir l’{name}", "fr", "formatjs"),
  ).toEqual({
    ok: true,
  });
  expect(
    validateTranslation("Open {name}", "Ouvrir l''{name}", "fr", "formatjs"),
  ).toEqual({
    ok: true,
  });
  // Elsewhere the apostrophe is the character.
  expect(
    validateTranslation("Open {name}", "Ouvrir l'{name}", "fr", "icu"),
  ).toEqual({ ok: true });
  // A tag too: Mastodon's Italian `l'<a>…</a>` prints the tag as text.
  expect(
    validateTranslation(
      "see the <a>policy</a>",
      "consulta l'<a>policy</a>",
      "it",
      "formatjs",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag", name: "a", quoted: true }],
  });
  expect(
    validateTranslation(
      "Failed to upload %'{file}'",
      "Échec %{file}",
      "fr",
      "formatjs",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "unexpected-placeholder", name: "file" }],
  });
  // The hint only where the quote took that placeholder.
  expect(
    validateTranslation(
      "Open {name} and {count}",
      "Ouvrir l''{name}",
      "fr",
      "formatjs",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
  const renamed = validateTranslation(
    "Open {name}",
    "Ouvrir l''{nom}",
    "fr",
    "formatjs",
  );
  expect(renamed.ok || renamed.errors.some((e) => "quoted" in e)).toBe(false);
  const other = validateTranslation(
    "Open {name} for {who}",
    "Ouvrir l'{name} pour",
    "fr",
    "formatjs",
  );
  expect(other).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "name", quoted: true },
      { code: "missing-placeholder", name: "who" },
    ],
  });
  expect(!other.ok && "quoted" in other.errors[1]!).toBe(false);
});

test("under vue-i18n's default rule a translation's number of forms is the source's, each index read as the rule reads it (#1018)", () => {
  const source = "{n} day | {n} days";
  const pl = "{n} minuta | {n} minuty | {n} minut";
  // Without the rule declared, the form count is the project's to know.
  expect(validateTranslation(source, pl, "pl", "vue")).toEqual({ ok: true });
  const declared = (target: string) =>
    validateTranslation(source, target, "pl", "vue", {
      pluralRules: "default",
    });
  expect(declared(pl)).toEqual({
    ok: true,
    incomplete: [{ code: "form-count", expected: 2, actual: 3 }],
  });
  expect(declared("{n} dzień | {n} dni")).toEqual({ ok: true });
  // A translation collapsed to one form shows it for every count.
  expect(declared("{n} dni")).toEqual({
    ok: true,
    incomplete: [{ code: "form-count", expected: 2, actual: 1 }],
  });
  // One form is right where the language reads every count alike.
  expect(
    validateTranslation(source, "{n}日", "ja", "vue", {
      pluralRules: "default",
    }),
  ).toEqual({ ok: true });
  // A plain source takes no forms either way.
  expect(
    validateTranslation("Save", "Zapisz", "pl", "vue", {
      pluralRules: "default",
    }),
  ).toEqual({ ok: true });
});

test('under easy_localization with pluralRules: "cldr" a plural follows CLDR, as ignorePluralRules: false picks (#961)', () => {
  const source = "{count, plural, one {{} file} other {{} files}}";
  const pl =
    "{count, plural, one {{} plik} few {{} pliki} many {{} plików} other {{} pliku}}";
  // By default the package picks by value, so few and many are dead.
  expect(
    validateTranslation(source, pl, "pl", "easy_localization"),
  ).toMatchObject({
    ok: true,
    incomplete: [
      { code: "unexpected-category", key: "few" },
      { code: "unexpected-category", key: "many" },
    ],
  });
  const cldr = (target: string) =>
    validateTranslation(source, target, "pl", "easy_localization", {
      pluralRules: "cldr",
    });
  expect(cldr(pl)).toEqual({ ok: true });
  expect(cldr("{count, plural, one {{} plik} other {{} pliku}}")).toMatchObject(
    {
      ok: true,
      incomplete: [
        { code: "missing-category", key: "few" },
        { code: "missing-category", key: "many" },
      ],
    },
  );
});

test("easy_localization's \"cldr\" asks for intl's categories, and a language intl lacks for the by-value ones (#961)", () => {
  const cldr = (target: string, language: string) =>
    validateTranslation(
      "{count, plural, one {{} file} other {{} files}}",
      target,
      language,
      "easy_localization",
      { pluralRules: "cldr" },
    );
  // Maltese two is never picked; few and many are.
  expect(
    cldr(
      "{count, plural, one {{} a} two {{} b} few {{} c} many {{} d} other {{} e}}",
      "mt",
    ),
  ).toMatchObject({
    incomplete: [{ code: "unexpected-category", key: "two" }],
  });
  // A code intl lacks picks zero by value.
  expect(
    cldr("{count, plural, zero {{} a} one {{} b} other {{} c}}", "ckb"),
  ).toEqual({
    ok: true,
  });
  // French many is no category intl picks.
  expect(
    cldr("{count, plural, one {{} a} many {{} b} other {{} c}}", "fr"),
  ).toMatchObject({
    incomplete: [{ code: "unexpected-category", key: "many" }],
  });
});

test("under chrome a bare $1–$9 is a placeholder; a lone $, a $40 and a $$NAME$ are said, as Chrome's getMessage reads them (#631)", () => {
  const de = (source: string, target: string) =>
    validateTranslation(source, target, "de", "chrome");
  // Chrome fills $1–$9 from the arguments.
  expect(
    de("Hello $1, you have $2 items", "Hallo, du hast Artikel"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "$1" },
      { code: "missing-placeholder", name: "$2" },
    ],
  });
  expect(de("Hello $1", "Hallo $1")).toEqual({ ok: true });
  // $$NAME$ is a $ before the NAME placeholder.
  expect(de("Hi $$NAME$", "Hallo $NAME$")).toEqual({ ok: true });
  expect(de("Hi $$NAME$", "Hallo")).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name" }],
  });
  // A lone $ is dropped with the character after it: a warning.
  expect(
    validateTranslation("$$ character", "$ karakter", "hu", "chrome"),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "chrome-dollar", at: 0, kind: "lone", written: "$ " }],
  });
  // $40 is text, a price, never substitution 4.
  expect(de("Pay $40", "Zahle $40")).toMatchObject({ ok: true });
  expect(chromeDollarsOf("Pay $40", "chrome")).toEqual([
    { at: 4, kind: "price", written: "$40" },
  ]);
  expect(chromeDollarsOf("$9 and $10", "chrome")).toEqual([
    { at: 7, kind: "price", written: "$10" },
  ]);
  expect(chromeDollarsOf("Hi $$NAME$", "chrome")).toEqual([
    { at: 3, kind: "doubled-name", written: "$$NAME$" },
  ]);
  // A run of n dollars shows n - 1, and what follows it is text: $$$1
  // is $$1, no substitution; $$$ is $$, no lone dollar.
  expect(chromeDollarsOf("$$$1 and $$$", "chrome")).toEqual([]);
  expect(de("Cost $$$1", "Preis $$$1")).toEqual({ ok: true });
  expect(partsOf("Cost $$$1", "chrome").placeholders).toEqual(new Set());
  // A trailing $ and $0 are lone.
  expect(chromeDollarsOf("a $0 b $", "chrome").map((d) => d.kind)).toEqual([
    "lone",
    "lone",
  ]);
  expect(chromeDollarsOf("Costs $$ and $1", "chrome")).toEqual([]);
  // A placeholder name may hold @, as Chrome's do.
  expect(de("$USER@HOST$", "$user@host$")).toEqual({ ok: true });
  expect(chromeDollarsOf("$ x", "icu")).toEqual([]);
});

test("a value the source's arguments declare is one a translation may print or pluralise on, and printing it shows the count (#1031)", () => {
  // Discourse's js.views_long: d-number.js passes `number` beside `count`.
  const source =
    "{count, plural, one {this topic has been viewed %{count} time} other {this topic has been viewed %{count} times}}";
  const ja =
    "{count, plural, other {このトピックは %{number} 回表示されました}}";
  const without = validateTranslation(source, ja, "ja", "rails");
  expect(without.ok ? [] : without.errors.map((e) => e.code).sort()).toEqual([
    "missing-placeholder",
    "unexpected-placeholder",
  ]);
  expect(
    validateTranslation(source, ja, "ja", "rails", { arguments: ["number"] }),
  ).toEqual({ ok: true });
  // A value the code does not pass is still unexpected.
  expect(
    validateTranslation(source, ja.replace("number", "num"), "ja", "rails", {
      arguments: ["number"],
    }).ok,
  ).toBe(false);
  // Mastodon: `{counter} you know`, a translation pluralising on the
  // `count` its code passes too.
  const mastodon = "{counter} you know";
  const pl =
    "{count, plural, one {{counter} znajomy} few {{counter} znajomych} many {{counter} znajomych} other {{counter} znajomego}}";
  expect(
    validateTranslation(mastodon, pl, "pl", "icu", { arguments: ["count"] }),
  ).toEqual({ ok: true });
  expect(validateTranslation(mastodon, pl, "pl", "icu").ok).toBe(false);
});

test("under gen_l10n =0, =1 and =2 are its zero, one and two: a category they stand for is no missing one, both written is an overridden branch, and one wider than its number is a warning (#1039)", () => {
  // wger's relativeDaysAgo: fr's one holds 0 and 1, and =0 catches 0
  // before the category, as Intl.pluralLogic does.
  const days =
    "{count, plural, =0{today} =1{yesterday} other{{count} days ago}}";
  const fr =
    "{count, plural, =0{aujourd'hui} =1{hier} other{il y a {count} jours}}";
  expect(validateTranslation(days, fr, "fr", "gen_l10n")).toEqual({ ok: true });
  // Under icu nothing changes.
  expect(validateTranslation(days, fr, "fr", "icu")).toMatchObject({
    incomplete: [{ code: "missing-category", key: "one" }],
  });
  // syncStatusPendingUploads: =1 is one, which fr also picks for 0 and
  // hr for 21.
  const pending =
    "{count, plural, =1{One local change} other{{count} local changes}}";
  expect(
    validateTranslation(
      pending,
      "{count, plural, =1{Une modification locale} other{{count} modifications locales}}",
      "fr",
      "gen_l10n",
    ),
  ).toEqual({
    ok: true,
    incomplete: [
      {
        code: "wide-exact",
        arg: "count",
        key: "=1",
        category: "one",
        values: [0],
      },
    ],
  });
  expect(
    validateTranslation(
      pending,
      "{count, plural, =1{Jedna lokalna promjena} few{{count} lokalne promjene} other{{count} lokalnih promjena}}",
      "hr",
      "gen_l10n",
    ),
  ).toEqual({
    ok: true,
    incomplete: [
      {
        code: "wide-exact",
        arg: "count",
        key: "=1",
        category: "one",
        values: [21, 31, 41],
        more: true,
      },
    ],
  });
  // The ar draft: =1 and one, of which gen-l10n keeps one.
  expect(
    validateTranslation(
      pending,
      "{count, plural, =1{تغيير محلي واحد} one{{count} تغيير} other{{count} تغييرات}}",
      "ar",
      "gen_l10n",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "overridden-branch", arg: "count", key: "=1", category: "one" },
    ],
  });
});

test("a category branch that writes the number 1 and no count, where the language's category holds more, is a warning (#1042)", () => {
  // wger's chartRangeWeeks: English's one is 1 alone.
  const weeks = "{count, plural, one{1 week} other{{count} weeks}}";
  const hr =
    "{count, plural, one{1 tjedan} few{{count} tjedna} other{{count} tjedana}}";
  for (const library of ["icu", "gen_l10n"] as const)
    expect(validateTranslation(weeks, hr, "hr", library)).toEqual({
      ok: true,
      incomplete: [
        {
          code: "fixed-count",
          arg: "count",
          key: "one",
          values: [21, 31, 41],
          more: true,
        },
      ],
    });
  // fr's one holds 0.
  expect(
    validateTranslation(
      weeks,
      "{count, plural, one{1 semaine} other{{count} semaines}}",
      "fr",
      "icu",
    ),
  ).toMatchObject({
    incomplete: [{ code: "fixed-count", key: "one", values: [0] }],
  });
  // A number an exact branch takes never reaches the category: wger's
  // fr healthSyncStatus, whose =0 leaves one to 1 alone; hr's one still
  // holds 21.
  const synced =
    "{count, plural, =0{none} one{1 entry} other{{count} entries}}";
  for (const library of ["icu", "gen_l10n"] as const) {
    expect(
      validateTranslation(
        synced,
        "{count, plural, =0{aucune} one{1 entrée} other{{count} entrées}}",
        "fr",
        library,
      ),
    ).toEqual({ ok: true });
    expect(
      validateTranslation(
        synced,
        "{count, plural, =0{bez} one{1 unos} few{{count} unosa} other{{count} unosa}}",
        "hr",
        library,
      ),
    ).toMatchObject({
      incomplete: [{ code: "fixed-count", values: [21, 31, 41], more: true }],
    });
  }
  // i18next takes a written zero for 0 in every language, and gen-l10n
  // a written zero for 0 and two for 2, before the category.
  for (const library of ["i18next", "gen_l10n"] as const)
    expect(
      validateTranslation(
        "{count, plural, zero{none} one{1 week} other{{count} weeks}}",
        "{count, plural, zero{aucune} one{1 semaine} other{{count} semaines}}",
        "fr",
        library,
      ).incomplete?.filter((e) => e.code === "fixed-count") ?? [],
    ).toEqual([]);
  // A 1 that is part of a time, a name or a number is no count.
  for (const one of ["u 1:30", "A1 tjedan", "1.5 tjedan", "1,5 tjedan"])
    expect(
      validateTranslation(
        weeks,
        `{count, plural, one{${one}} few{{count} tjedna} other{{count} tjedana}}`,
        "hr",
        "icu",
      ),
    ).toEqual({ ok: true });
  // Arabic-Indic and full-width digits are the same 1.
  for (const one of ["۱ هفته", "１ 週"])
    expect(
      validateTranslation(
        weeks,
        `{count, plural, one{${one}} few{{count} tjedna} other{{count} tjedana}}`,
        "hr",
        "icu",
      ),
    ).toMatchObject({ incomplete: [{ code: "fixed-count" }] });
  // de's one is 1 alone; a branch that prints the count is fine; so is
  // one whose 1 is part of a number, or a count-free text.
  expect(
    validateTranslation(
      weeks,
      "{count, plural, one{1 Woche} other{{count} Wochen}}",
      "de",
      "icu",
    ),
  ).toEqual({ ok: true });
  for (const one of ["{count} tjedan", "# tjedan", "11 tjedana", "tjedan"])
    expect(
      validateTranslation(
        weeks,
        `{count, plural, one{${one}} few{{count} tjedna} other{{count} tjedana}}`,
        "hr",
        "icu",
      ),
    ).toEqual({ ok: true });
  // counterpart picks one for 1 alone, whatever the language.
  expect(
    validateTranslation(
      "{count, plural, one{1 week} other{%(count)s weeks}}",
      "{count, plural, one{1 tjedan} other{%(count)s tjedana}}",
      "hr",
      "counterpart",
    ).ok,
  ).toBe(true);
});

test("an =N branch in a plural read whole is invalid: the catalogue's plurals hold categories only (#1051)", () => {
  // Rails and i18next pick a written zero for 0 (#983, #985).
  for (const [library, one, other, zero] of [
    ["printf", "%d file", "%d files", "other"],
    ["rails", "%{count} file", "%{count} files", "zero"],
    ["qt", "%n file", "%n files", "other"],
    ["i18next", "{{count}} file", "{{count}} files", "zero"],
  ] as const) {
    const source = `{count, plural, one {${one}} other {${other}}}`;
    expect(
      validateTranslation(
        source,
        `{count, plural, =0 {keine} one {${one}} other {${other}}}`,
        "de",
        library,
      ),
      library,
    ).toEqual({
      ok: false,
      errors: [
        { code: "exact-branch", arg: "count", key: "=0", category: zero },
      ],
    });
  }
  // A String Catalog's argN plural, printf's too.
  expect(
    validateTranslation(
      "{arg1, plural, one {%lld file} other {%lld files}}",
      "{arg1, plural, =1 {eine Datei} other {%lld Dateien}}",
      "de",
      "printf",
    ),
  ).toMatchObject({
    ok: false,
    // Named by position, as every check of a String Catalog plural is.
    errors: [{ code: "exact-branch", arg: "1", key: "=1", category: "one" }],
  });
  // The branch advised is the one the library picks for N: i18next's,
  // Rails' and counterpart's written zero, easy_localization's two, and
  // among a gettext file's own forms.
  for (const [library, one, other, key, category, language, pluralForms] of [
    [
      "i18next",
      "{{count}} file",
      "{{count}} files",
      "=0",
      "zero",
      "de",
      undefined,
    ],
    ["rails", "%{count} file", "%{count} files", "=0", "zero", "de", undefined],
    [
      "counterpart",
      "%(count)s file",
      "%(count)s files",
      "=0",
      "zero",
      "de",
      undefined,
    ],
    ["easy_localization", "{} file", "{} files", "=2", "two", "de", undefined],
    ["printf", "%d file", "%d files", "=5", "other", "ru", ["one", "other"]],
  ] as const)
    expect(
      validateTranslation(
        `{count, plural, one {${one}} other {${other}}}`,
        `{count, plural, ${key} {x} one {${one}} other {${other}}}`,
        language,
        library,
        pluralForms ? { pluralForms } : {},
      ),
      library,
    ).toMatchObject({ errors: [{ code: "exact-branch", key, category }] });
  // easy_localization picking by CLDR (#961): ru's 5 is many, de's 2 other.
  for (const [language, key, category] of [
    ["ru", "=5", "many"],
    ["de", "=2", "other"],
  ] as const)
    expect(
      validateTranslation(
        "{count, plural, one {{} file} other {{} files}}",
        `{count, plural, ${key} {x} one {{} y} other {{} z}}`,
        language,
        "easy_localization",
        { pluralRules: "cldr" },
      ),
      language,
    ).toMatchObject({ errors: [{ code: "exact-branch", key, category }] });
  // ICU's own plurals hold them.
  expect(
    validateTranslation(
      "{count, plural, one {# file} other {# files}}",
      "{count, plural, =0 {keine} one {# Datei} other {# Dateien}}",
      "de",
      "icu",
    ).ok,
  ).toBe(true);
});

test("a printf plural whose forms hold a literal {…} is a plural, its translations checked as one (#1052)", () => {
  const source = "{count, plural, one {1 color} other {{num} colors}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, one {{num} barva} few {{num} barvy} other {{num} barev}}",
      "cs",
      "printf",
    ),
  ).toEqual({ ok: true });
  expect(validateTranslation(source, "{num} צבעים", "he", "printf").ok).toBe(
    false,
  );
});

test("exact keys a gettext file reads one form by take one text: two are refused, as the file cannot hold them (#1060)", () => {
  const source = "{count, plural, one {%d file} other {%d files}}";
  // Filipino's common nplurals=2; plural=(n > 1): form 0 is 0 and 1.
  const tl = {
    pluralForms: ["=0", "=1", "other"],
    pluralShared: [["=0", "=1"]],
  };
  expect(
    validateTranslation(
      source,
      "{count, plural, =0 {%d file} =1 {%d file} other {%d mga file}}",
      "tl",
      "printf",
      tl,
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation(
      source,
      "{count, plural, =0 {Walang file} =1 {%d file} other {%d mga file}}",
      "tl",
      "printf",
      tl,
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "shared-form", arg: "count", keys: ["=0", "=1"] }],
  });
  // One of the pair alone is the file's form; the other key is said
  // missing, as any is.
  expect(
    validateTranslation(
      source,
      "{count, plural, =1 {%d file} other {%d mga file}}",
      "tl",
      "printf",
      tl,
    ).ok,
  ).toBe(true);
  // Without the grouping, as an older CLI pushes, nothing is said.
  expect(
    validateTranslation(
      source,
      "{count, plural, =0 {Walang file} =1 {%d file} other {%d mga file}}",
      "tl",
      "printf",
      { pluralForms: tl.pluralForms },
    ).ok,
  ).toBe(true);
});

test("shared exact keys compare as the writer does, by the text written, not by its reading (#1060 review)", () => {
  const source = "{count, plural, one {%d file} other {%d files}}";
  const tl = {
    pluralForms: ["=0", "=1", "other"],
    pluralShared: [["=0", "=1"]],
  };
  // Each reads the same in both branches, yet is written two ways.
  for (const [library, text] of [
    ["printf", "{count, plural, =0 {100%%} =1 {100%} other {%d b}}"],
    [
      "icu",
      "{count, plural, =0 {{count} file} =1 {{ count } file} other {# b}}",
    ],
    [
      "icu",
      "{count, plural, =0 {{count, number} f} =1 {{count,number} f} other {# b}}",
    ],
    ["icu", "{count, plural, =0 {<b>x</b>} =1 {<b >x</b>} other {# b}}"],
  ] as const)
    expect(
      validateTranslation(source, text, "tl", library, tl),
      text,
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        { code: "shared-form", arg: "count", keys: ["=0", "=1"] },
      ]),
    });
});

test("under android, <xliff:g> is a tag a translation keeps, by its name (#1067)", () => {
  const source = 'Load up to <xliff:g id="messages_to_load">%d</xliff:g> more';
  const check = (text: string) =>
    validateTranslation(source, text, "ta-IN", "android");
  expect(
    check('<xliff:g id="messages_to_load">%d</xliff:g> வரை ஏற்றவும்').ok,
  ).toBe(true);
  // thunderbird-android's ta-IN, its element turned to text and its name
  // and attribute translated.
  expect(
    check(
      '<Xliff வரை ஏற்றவும்: g ஐடி = "messages_to_load">%d </xliff: g> மேலும்',
    ),
  ).toMatchObject({
    ok: false,
    errors: expect.arrayContaining([
      { code: "missing-tag", name: 'xliff:g id="messages_to_load"' },
    ]),
  });
  expect(check("%d மேலும்")).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag", name: 'xliff:g id="messages_to_load"' }],
  });
  // Its id is no part of it: aapt strips the element, so a translated
  // id never reaches the app.
  expect(check('<xliff:g id="ஏற்ற">%d</xliff:g> மேலும்').ok).toBe(true);
  // Other libraries read <a:b> as text, as before.
  expect(validateTranslation("Go <a:b>x</a:b>", "Vai", "de", "icu").ok).toBe(
    true,
  );
});

test("under android, a verb the source wraps in <xliff:g> is wrapped wherever a translation writes it (#1067 review)", () => {
  const two =
    '<xliff:g id="name">%1$s</xliff:g> (<xliff:g id="size">%2$s</xliff:g>)';
  for (const text of [
    '<xliff:g id="name">%1$s</xliff:g> (<Xliff: g id = "size">%2$s</xliff: g>)',
    '<xliff:g id="name">%1$s</xliff:g> (%2$s)',
  ])
    expect(
      validateTranslation(two, text, "ta-IN", "android"),
      text,
    ).toMatchObject({
      ok: false,
      errors: [{ code: "missing-tag", name: 'xliff:g id="size"' }],
    });
  // Translated ids: valid.
  expect(
    validateTranslation(
      two,
      '<xliff:g id="nome">%1$s</xliff:g> (<xliff:g id="size">%2$s</xliff:g>)',
      "it",
      "android",
    ).ok,
  ).toBe(true);
  // An extra element is harmless, aapt stripping it.
  expect(
    validateTranslation(
      'Go <xliff:g id="n">%d</xliff:g>',
      'Vai <xliff:g id="n">%d</xliff:g> <xliff:g id="m">x</xliff:g>',
      "it",
      "android",
    ).ok,
  ).toBe(true);
  // Per branch: one that writes the verb bare is named; one that writes
  // no number at all, German's one or Arabic's zero, keeps nothing to
  // wrap (Android lint's ImpliedQuantity).
  const plural =
    '{quantity, plural, one {<xliff:g id="n">%d</xliff:g> file} other {<xliff:g id="n">%d</xliff:g> files}}';
  const check = (text: string, language: string) =>
    validateTranslation(plural, text, language, "android");
  expect(
    check(
      '{quantity, plural, one {<xliff:g id="n">%d</xliff:g> plik} few {<xliff:g id="n">%d</xliff:g> pliki} many {<xliff:g id="n">%d</xliff:g> plików} other {<xliff:g id="n">%d</xliff:g> pliku}}',
      "pl",
    ).ok,
  ).toBe(true);
  expect(
    check(
      '{quantity, plural, one {<xliff:g id="n">%d</xliff:g> plik} few {%d pliki} many {<xliff:g id="n">%d</xliff:g> plików} other {<xliff:g id="n">%d</xliff:g> pliku}}',
      "pl",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-tag", name: 'xliff:g id="n"' }],
  });
  expect(
    check(
      '{quantity, plural, one {Eine Datei} other {<xliff:g id="n">%d</xliff:g> Dateien}}',
      "de",
    ).ok,
  ).toBe(true);
  expect(
    check(
      '{quantity, plural, zero {لا ملفات} one {<xliff:g id="n">%d</xliff:g> ملف} two {<xliff:g id="n">%d</xliff:g> ملفان} few {<xliff:g id="n">%d</xliff:g> ملفات} many {<xliff:g id="n">%d</xliff:g> ملفًا} other {<xliff:g id="n">%d</xliff:g> ملف}}',
      "ar",
    ).ok,
  ).toBe(true);
});

test("each copy of a plural is checked for the categories the runtime picks, one finding per argument and category (#1085)", () => {
  const source =
    "{a, select, x {{n, plural, one {# a} other {# b}}} other {{n, plural, one {# c} other {# d}}}}";
  expect(
    validateTranslation(
      source,
      "{a, select, x {{n, plural, one {# a} few {# f} other {# b}}} other {{n, plural, one {# c} other {# d}}}}",
      "hr",
      "icu",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "n", key: "few" }],
  });
  expect(
    validateTranslation(
      source,
      "{a, select, x {{n, plural, one {# a} few {# f} other {# b}}} other {{n, plural, one {# c} few {# g} other {# d}}}}",
      "hr",
      "icu",
    ),
  ).toEqual({ ok: true });
  // Two copies lacking it say it once.
  expect(
    validateTranslation(
      source,
      "{a, select, x {{n, plural, one {# a} other {# b}}} other {{n, plural, one {# c} other {# d}}}}",
      "hr",
      "icu",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "n", key: "few" }],
  });
});

test("a language of the source's base is asked per copy only for what the source's own copy has (#1085 review)", () => {
  const source =
    "{n, plural, one {# file} other {# files}} in {n, plural, other {folders}}";
  for (const [language, base] of [
    ["en-GB", "en"],
    ["pt-BR", "pt-PT"],
  ] as const)
    expect(
      validateTranslation(source, source, language, "icu", {
        sourceLanguage: base,
      }),
      language,
    ).toEqual({ ok: true });
  // The copy that has `one` in the source still needs it.
  expect(
    validateTranslation(
      source,
      "{n, plural, other {# files}} in {n, plural, other {folders}}",
      "en-GB",
      "icu",
      { sourceLanguage: "en" },
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "n", key: "one" }],
  });
  // A translation with another number of copies is read against what
  // any of the source's copies has.
  expect(
    validateTranslation(
      source,
      "{n, plural, one {# file} other {# files}} in folders",
      "en-GB",
      "icu",
      { sourceLanguage: "en" },
    ).ok,
  ).toBe(true);
});

test("a plural its file holds as forms takes categories only, each form splitting back (#704)", () => {
  // A plural object under icu, an Android <plurals>, i18next's keys.
  for (const [library, one, other] of [
    ["icu", "{count} room", "{count} rooms"],
    ["android", "%d room", "%d rooms"],
    ["i18next", "{{count}} room", "{{count}} rooms"],
  ] as const) {
    const source = `{count, plural, one {${one}} other {${other}}}`;
    const target = `{count, plural, =0 {keine} one {${one}} other {${other}}}`;
    expect(
      validateTranslation(source, target, "de", library, {
        pluralAsForms: true,
      }),
      library,
    ).toMatchObject({
      ok: false,
      errors: [{ code: "exact-branch", arg: "count", key: "=0" }],
    });
  }
  // An ICU string holds an =N branch.
  expect(
    validateTranslation(
      "{count, plural, one {{count} room} other {{count} rooms}}",
      "{count, plural, =0 {keine} one {{count} Raum} other {{count} Räume}}",
      "de",
      "icu",
    ),
  ).toEqual({ ok: true });
  // A form whose braces do not balance cannot be split back into forms,
  // though i18next, which reads a lone brace as text, reads it.
  const source =
    "{count, plural, one {{{count}} room} other {{{count}} rooms}}";
  const target = "{count, plural, one {a { b} other {{{count}} Räume}}";
  expect(
    validateTranslation(source, target, "de", "i18next", {
      pluralAsForms: true,
    }),
  ).toEqual({
    ok: false,
    errors: [{ code: "unsplittable-form", arg: "count", key: "one" }],
  });
  expect(validateTranslation(source, target, "de", "i18next")).toEqual({
    ok: true,
  });
  // fmt's `{{` and `}}` are a brace each, a pair the writer splits.
  expect(
    validateTranslation(
      "{count, plural, one {{} room} other {{} rooms}}",
      "{count, plural, one {{} Raum {{} other {{} Räume}}",
      "de",
      "fmt",
      { pluralAsForms: true },
    ),
  ).toEqual({ ok: true });
  // printf's plural read whole is refused as broken already.
  expect(
    validateTranslation(
      "{count, plural, one {%d room} other {%d rooms}}",
      "{count, plural, one {%d { a} other {%d Räume}}",
      "de",
      "printf",
      { pluralAsForms: true },
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "invalid-icu" }] });
});

test("counterpart and easy_localization refuse an =N branch, naming the category their runtime reads for it, which it leaves empty (#964)", () => {
  for (const [library, one, other] of [
    ["counterpart", "%(count)s file", "%(count)s files"],
    ["easy_localization", "{} file", "{} files"],
  ] as const) {
    const source = `{count, plural, one {${one}} other {${other}}}`;
    expect(
      validateTranslation(
        source,
        `{count, plural, =1 {eine Datei} other {${other}}}`,
        "de",
        library,
      ),
      library,
    ).toEqual({
      ok: false,
      errors: [
        { code: "exact-branch", arg: "count", key: "=1", category: "one" },
      ],
      incomplete: [{ code: "missing-category", arg: "count", key: "one" }],
    });
    expect(
      validateTranslation(
        source,
        `{count, plural, =0 {keine} one {${one}} other {${other}}}`,
        "de",
        library,
      ),
      library,
    ).toEqual({
      ok: false,
      errors: [
        { code: "exact-branch", arg: "count", key: "=0", category: "zero" },
      ],
    });
  }
});

test("an =N branch a plural cannot hold covers no category; one the file's own forms name does (#964)", () => {
  for (const [library, count, options] of [
    ["printf", "%d", {}],
    ["i18next", "{{count}}", {}],
    ["rails", "%{count}", {}],
    ["qt", "%n", {}],
    ["fmt", "{}", {}],
    ["icu", "{count}", { pluralAsForms: true }],
  ] as const)
    expect(
      validateTranslation(
        `{count, plural, one {${count} file} other {${count} files}}`,
        `{count, plural, =1 {eine Datei} other {${count} Dateien}}`,
        "de",
        library,
        options,
      ),
      library,
    ).toMatchObject({
      ok: false,
      incomplete: [{ code: "missing-category", arg: "count", key: "one" }],
    });
  // A gettext file's own `=1` holds the text, as its Plural-Forms read it.
  expect(
    validateTranslation(
      "{count, plural, one {%d file} other {%d files}}",
      "{count, plural, =1 {usa ka file} other {%d ka mga file}}",
      "ceb",
      "printf",
      { pluralForms: ["=1", "other"] },
    ),
  ).toEqual({ ok: true });
  // An ICU string holds it, and it covers de's one.
  expect(
    validateTranslation(
      "{count, plural, one {# file} other {# files}}",
      "{count, plural, =1 {eine Datei} other {# Dateien}}",
      "de",
      "icu",
    ),
  ).toEqual({ ok: true });
});

test("a gettext file read under counterpart or easy_localization takes the file's own forms, as under any library (#964, #982)", () => {
  const codes = (
    library: "printf" | "counterpart" | "easy_localization",
    count: string,
    text: string,
  ) => {
    const result = validateTranslation(
      `{count, plural, one {${count} file} other {${count} files}}`,
      text.replaceAll("#", count),
      "ceb",
      library,
      { pluralForms: ["=1", "other"] },
    );
    return [
      ...(result.ok ? [] : result.errors),
      ...(result.incomplete ?? []),
    ].map((e) => [
      e.code,
      "key" in e ? e.key : undefined,
      "category" in e ? e.category : undefined,
    ]);
  };
  for (const text of [
    "{count, plural, =1 {usa ka file} other {# ka mga file}}",
    "{count, plural, one {usa} other {#}}",
    "{count, plural, =0 {wala} =1 {usa} other {#}}",
  ]) {
    expect(codes("counterpart", "%(count)s", text), text).toEqual(
      codes("printf", "%d", text),
    );
    expect(codes("easy_localization", "{}", text), text).toEqual(
      codes("printf", "%d", text),
    );
  }
});

test("a gettext file whose Plural-Forms are CLDR's reads under counterpart and easy_localization as under printf, which records none (#964)", () => {
  const codes = (
    library: "printf" | "counterpart" | "easy_localization",
    count: string,
    language: string,
    text: string,
  ) => {
    const result = validateTranslation(
      `{count, plural, one {${count} file} other {${count} files}}`,
      text.replaceAll("#", count),
      language,
      library,
      {
        pluralAsForms: true,
        ...(library !== "printf" && {
          pluralForms: pluralCategoriesOf(language),
        }),
      },
    );
    return [
      ...(result.ok ? [] : result.errors),
      ...(result.incomplete ?? []),
    ].map((e) => [
      e.code,
      "key" in e ? e.key : undefined,
      "category" in e ? e.category : undefined,
    ]);
  };
  for (const language of ["fr", "es", "pt", "it", "de", "ru", "ja", "ar"])
    for (const text of [
      "{count, plural, one {#} other {#}}",
      "{count, plural, one {#} many {#} other {#}}",
      "{count, plural, zero {#} one {#} other {#}}",
      "{count, plural, =0 {#} one {#} other {#}}",
      "{count, plural, one {#} few {#} many {#} other {#}}",
    ]) {
      const printf = codes("printf", "%d", language, text);
      expect(
        codes("counterpart", "%(count)s", language, text),
        `${language} ${text}`,
      ).toEqual(printf);
      expect(
        codes("easy_localization", "{}", language, text),
        `${language} ${text}`,
      ).toEqual(printf);
    }
});

test("a target plural without other is missing-other on its argument, a source's still a parse error (#975)", () => {
  expect(
    validateTranslation(
      "{count, plural, one {%(count)s more} other {%(count)s more}}",
      "{count, plural, one {%(count)s weitere}}",
      "de",
      "counterpart",
      { pluralAsForms: true },
    ),
  ).toEqual({ ok: false, errors: [{ code: "missing-other", arg: "count" }] });
  expect(
    validateTranslation(
      "{n, plural, one {# file} other {# files}}",
      "{n, plural, one {x}}",
      "de",
      "icu",
    ),
  ).toEqual({ ok: false, errors: [{ code: "missing-other", arg: "n" }] });
  expect(
    validateTranslation(
      "{n, plural, one {x}}",
      "{n, plural, one {y}}",
      "de",
      "icu",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        code: "invalid-icu",
        where: "source",
        message: "plural needs an other branch",
      },
    ],
  });
});

test("a mistyped rails %{ is refused beside the translation's other findings, not instead of them (#976)", () => {
  const stray =
    "%{ opens no placeholder here: one is a name without spaces and a closing }; write %%{ for the text itself";
  const probe = validateTranslation(
    "%{user} posted %{description} in %{category}",
    "%{user alichapisha %{kategoria]",
    "sw",
    "rails",
  );
  expect(probe.ok).toBe(false);
  const errors = probe.ok ? [] : probe.errors;
  expect(errors.slice(0, 2)).toEqual([
    { code: "invalid-icu", where: "target", message: stray, position: 0 },
    { code: "invalid-icu", where: "target", message: stray, position: 19 },
  ]);
  expect(errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "missing-placeholder",
        name: "description",
      }),
      expect.objectContaining({
        code: "missing-placeholder",
        name: "category",
      }),
    ]),
  );
  // A mistyped %{ alone is the one error.
  expect(
    validateTranslation(
      "Hello %{name}",
      "Habari %{name} %{dana]",
      "sw",
      "rails",
    ),
  ).toEqual({
    ok: false,
    errors: [
      { code: "invalid-icu", where: "target", message: stray, position: 15 },
    ],
  });
  // In a tag's attribute, read as HTML, it is said at the tag.
  expect(
    validateTranslation(
      '<a href="%{url}">%{name}</a>',
      '<a href="%{url]">%{jina}</a>',
      "sw",
      "rails",
      { richText: "html" },
    ),
  ).toEqual({
    ok: false,
    errors: [
      { code: "invalid-icu", where: "target", message: stray, position: 0 },
      { code: "missing-placeholder", name: "name", written: "%{name}" },
      { code: "unexpected-placeholder", name: "jina", written: "%{jina}" },
      { code: "missing-placeholder", name: "url", written: "%{url}" },
    ],
  });
});

test("a mistyped rails %{ is said once, whatever readings the parser tries and gives up (#976)", () => {
  const stray =
    "%{ opens no placeholder here: one is a name without spaces and a closing }; write %%{ for the text itself";
  const at = (position: number) => ({
    code: "invalid-icu",
    where: "target",
    message: stray,
    position,
  });
  const strays = (result: ReturnType<typeof validateTranslation>) =>
    result.ok ? [] : result.errors.filter((e) => e.code === "invalid-icu");
  // A plural read whole, given up for the text after it.
  expect(
    strays(
      validateTranslation(
        "You have %{count} items",
        "{count, plural, one {%{count] kitu} other {vitu}} na {x}",
        "sw",
        "rails",
      ),
    ),
  ).toEqual([at(21)]);
  // A tag whose close is in another branch, read again as prose.
  expect(
    strays(
      validateTranslation(
        "{count, plural, one {<b>%{count} one} other {</b> many}}",
        "{count, plural, one {<b>%{count] moja} other {</b> nyingi}}",
        "sw",
        "rails",
        { richText: "html" },
      ),
    ),
  ).toEqual([at(24)]);
  expect(
    strays(
      validateTranslation(
        '{count, plural, one {<a href="%{u}">%{count} one} other {</a> many}}',
        '{count, plural, one {<a href="%{u]">%{count} moja} other {</a> nyingi}}',
        "sw",
        "rails",
        { richText: "html" },
      ),
    ),
  ).toEqual([at(21)]);
  // Two in one tag's attributes are said once, at the tag.
  expect(
    validateTranslation(
      '<a href="%{url}" title="%{name}">x</a>',
      '<a href="%{url]" title="%{name]">x</a>',
      "sw",
      "rails",
      { richText: "html" },
    ),
  ).toEqual({
    ok: false,
    errors: [
      at(0),
      { code: "missing-placeholder", name: "url", written: "%{url}" },
      { code: "missing-placeholder", name: "name", written: "%{name}" },
    ],
  });
  // A plural hash read whole.
  expect(
    validateTranslation(
      "{count, plural, one {%{count} item} other {%{count} items}}",
      "{count, plural, one {%{count] kitu} other {%{count} vitu}}",
      "sw",
      "rails",
    ),
  ).toEqual({ ok: false, errors: [at(21)] });
});

test("under fluent, a translation adds no format its source lacks, which pull would write as a function (#1089)", () => {
  for (const [target, actual] of [
    ["Total {n, date}", "date"],
    ["Total {n, number}", "number"],
    ["Total {n, number, minimumFractionDigits: 2}", "number"],
  ] as const)
    expect(
      validateTranslation("Total {n}", target, "de", "fluent"),
      target,
    ).toEqual({
      ok: false,
      errors: [
        { code: "unexpected-format", name: "n", expected: null, actual },
      ],
    });
  // A format the source has keeps its style the translator's.
  expect(
    validateTranslation(
      "On {d, date}",
      'Am {d, date, dateStyle: "short"}',
      "de",
      "fluent",
    ),
  ).toEqual({ ok: true });
  // Elsewhere a format is the translator's to add.
  expect(
    validateTranslation("Total {n}", "Total {n, number}", "de", "icu"),
  ).toEqual({
    ok: true,
  });
});

test("under fluent, a format is added on no value the source passes, whether or not it prints it (#1089)", () => {
  const added = (actual: string) => ({
    ok: false,
    errors: [{ code: "unexpected-format", name: "n", expected: null, actual }],
  });
  // A plural's count the source never prints.
  const counted = "{n, plural, one {one} other {many}}";
  expect(
    validateTranslation(
      counted,
      "{n, plural, one {eins} other {{n, date} viele}}",
      "de",
      "fluent",
    ),
  ).toEqual(added("date"));
  expect(
    validateTranslation(
      counted,
      "{n, plural, one {eins} other {{n, number} viele}}",
      "de",
      "fluent",
    ),
  ).toEqual(added("number"));
  expect(
    validateTranslation(counted, "{n, number} 個", "ja", "fluent"),
  ).toEqual(added("number"));
  // Relay's: a source that formats the value in one branch and prints it
  // bare in another keeps a format the translation writes in both.
  expect(
    validateTranslation(
      "{s, plural, one {{s} second} other {{s, number, minimumIntegerDigits: 2} seconds}}",
      "{s, plural, one {{s, number, minimumIntegerDigits: 2} segundo} other {{s, number, minimumIntegerDigits: 2} segundos}}",
      "es",
      "fluent",
    ),
  ).toEqual({ ok: true });
});

test("under easy_localization, a one-category language's plain text prints its count through {}, which plural() fills (#1094)", () => {
  const source = "{count, plural, one {{} item} other {{} items}}";
  expect(
    validateTranslation(source, "{} 个项目", "zh", "easy_localization"),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(source, "{count} 个项目", "zh", "easy_localization"),
  ).toEqual({
    ok: false,
    errors: [
      { code: "unexpected-placeholder", name: "count", written: "{count}" },
    ],
  });
  expect(
    validateTranslation(source, "个项目", "zh", "easy_localization"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
  // A source whose forms name {count} keeps it named.
  expect(
    validateTranslation(
      "{count, plural, one {{count} item} other {{count} items}}",
      "{count} 个项目",
      "zh",
      "easy_localization",
    ),
  ).toEqual({ ok: true });
  // Under icu a plain {} is no count.
  expect(
    validateTranslation(
      "{count, plural, one {# item} other {# items}}",
      "{} 个项目",
      "zh",
      "icu",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", where: "target" }],
  });
});

test("under easy_localization, a plain text's {count} is text unless the call names the count (#1094)", () => {
  const source = "{count, plural, one {{} item} other {{} items}}";
  const named = {
    ok: false,
    errors: [
      { code: "unexpected-placeholder", name: "count", written: "{count}" },
    ],
  };
  // Declared in `arguments`, the call passes it by name.
  expect(
    validateTranslation(source, "{count} 个", "zh", "easy_localization", {
      arguments: ["count"],
    }),
  ).toEqual({ ok: true });
  // Any of the source's forms naming it shows the call does.
  expect(
    validateTranslation(
      "{count, plural, one {{count} item} other {{} items}}",
      "{count} 个",
      "zh",
      "easy_localization",
    ),
  ).toEqual({ ok: true });
  // Wherever the target writes it.
  expect(
    validateTranslation(source, "{} 个 {count}", "zh", "easy_localization"),
  ).toEqual(named);
  expect(
    validateTranslation(source, "{count} 个 {}", "zh", "easy_localization"),
  ).toMatchObject({ ok: false, errors: expect.arrayContaining(named.errors) });
  // A source that prints no count names none either.
  expect(
    validateTranslation(
      "{count, plural, one {one item} other {some items}}",
      "{count} 个",
      "zh",
      "easy_localization",
    ),
  ).toEqual(named);
  expect(
    validateTranslation(
      "{count, plural, one {one item in {folder}} other {items in {folder}}}",
      "{folder} {count} 个",
      "zh",
      "easy_localization",
    ),
  ).toEqual(named);
});

test("a placeholder kept in a tag's attribute and also written in the text is said unexpected once (#1135)", () => {
  const unexpected = (
    source: string,
    target: string,
    syntax: Parameters<typeof validateTranslation>[3],
  ) => {
    const result = validateTranslation(source, target, "pt", syntax, {
      richText: "html",
    });
    return result.ok
      ? []
      : result.errors.filter((e) => e.code === "unexpected-placeholder");
  };
  for (const [syntax, source, target, name] of [
    [
      "rails",
      '<a href="%{path}">Go</a>',
      '<a href="%{path}">Vai %{path}</a>',
      "path",
    ],
    [
      "icu",
      '<a href="{path}">Go</a>',
      '<a href="{path}">Vai {path}</a>',
      "path",
    ],
    [
      "i18next",
      '<a href="{{path}}">Go</a>',
      '<a href="{{path}}">Vai {{path}}</a>',
      "path",
    ],
    ["icu", '<a href="/a">Go</a>', '<a href="{u}">{u}</a>', "u"],
    ["android", '<a href="https://x">Go</a>', '<a href="%s">%1$s</a>', "1"],
  ] as const)
    expect(
      unexpected(source, target, syntax),
      `${syntax} ${target}`,
    ).toMatchObject([{ code: "unexpected-placeholder", name }]);
  // The text's written form is the one kept.
  expect(
    unexpected(
      '<a href="https://x">Go</a>',
      '<a href="%s">%1$s</a>',
      "android",
    ),
  ).toEqual([{ code: "unexpected-placeholder", name: "1", written: "%1$s" }]);
  // A prose tag's attribute placeholders are the text's (#986): once too.
  const prose = validateTranslation(
    "Go",
    "Vai <x y='{{u}}'> {{u}}",
    "pt",
    "i18next",
  );
  expect(
    prose.ok
      ? []
      : prose.errors.filter((e) => e.code === "unexpected-placeholder"),
  ).toMatchObject([{ name: "u" }]);
  // Moved out of an attribute into the text: one moved-placeholder.
  const moved = (target: string) =>
    validateTranslation('<a href="%{path}">Go</a>', target, "pt", "rails", {
      richText: "html",
    });
  expect(moved('<a href="/x">Vai %{path}</a>')).toMatchObject({
    ok: false,
    errors: [{ code: "moved-placeholder", name: "path" }],
  });
  // A source writing it in both places needs both.
  for (const target of ['<a href="{u}">x</a>', '<a href="/x">{u}</a>'])
    expect(
      validateTranslation('<a href="{u}">{u}</a>', target, "pt", "icu", {
        richText: "html",
      }),
      target,
    ).toMatchObject({
      ok: false,
      errors: [{ code: "missing-placeholder", name: "u" }],
    });
});

test("under android a translation is checked as Java's Formatter reads it (#1145)", () => {
  expect(validateTranslation("%1$s %s", "%1$s %1$s", "fr", "android")).toEqual({
    ok: true,
  });
  expect(
    validateTranslation("Hi %[1]s", "Salut %1$s", "fr", "android"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", where: "source" }],
  });
  expect(
    validateTranslation("Hi %1$s", "Salut %[1]s", "fr", "android"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", where: "target" }],
  });
  expect(
    validateTranslation(
      '<a title="{" href="%s">%s</a>',
      '<a title="{" href="%1$s">%2$s</a>',
      "fr",
      "android",
    ),
  ).toEqual({ ok: true });
  // An attribute's %n takes no position in the tag's identity either.
  expect(
    validateTranslation(
      '<a href="x%ny%s">%s</a>',
      '<a href="x%ny%1$s">%2$s</a>',
      "fr",
      "android",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      '<a href="%1$s">%s</a>',
      '<a href="%[1]s">%s</a>',
      "fr",
      "android",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", where: "target" }],
  });
});

test("where tags are compared, a broken tag holding a placeholder in its attribute is the tag's finding alone (#1146)", () => {
  for (const [syntax, source, target] of [
    ["android", '<a href="%1$s">%2$s</a>', '<a href="%1$s">%2$s'],
    ["android", '<a href="%1$s">Go</a>', '<href="%1$s">Vai</a>'],
    ["i18next", '<a href="{{url}}">Go</a>', '<href="{{url}}">Vai</a>'],
    // Every reading that compares tags (#1146 review).
    ["icu", '<a href="{u}">Go</a>', "<a>Vai {u}</a>"],
    ["rails", '<a href="%{u}">Go</a>', "<a>Vai %{u}</a>"],
    ["counterpart", '<a href="%(u)s">Go</a>', "<a>Vai %(u)s</a>"],
  ] as const) {
    const result = validateTranslation(source, target, "pt", syntax);
    expect(result.ok, target).toBe(false);
    if (result.ok) continue;
    expect(
      result.errors.map((e) => e.code),
      target,
    ).toContain("missing-tag");
    expect(
      result.errors.filter((e) => e.code === "moved-placeholder"),
      target,
    ).toEqual([]);
  }
  // Where no tags are compared, the moved value is the finding.
  const htmlKey = validateTranslation(
    '<a href="%{u}">Go</a>',
    '<href="%{u}">Vai</a>',
    "pt",
    "rails",
    { richText: "html-key" },
  );
  expect(htmlKey.ok ? [] : htmlKey.errors.map((e) => e.code)).toContain(
    "moved-placeholder",
  );
});

test("under lingui a placeholder a closed quote takes is missing, said so; an apostrophe no quote closes is the character (#1154)", () => {
  expect(
    validateTranslation("Open {name}", "Ouvrir l'{name}", "fr", "lingui"),
  ).toEqual({ ok: true });
  expect(
    validateTranslation("Open {name}", "Ouvrir '{name}'", "fr", "lingui"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "name", quoted: true }],
  });
});
