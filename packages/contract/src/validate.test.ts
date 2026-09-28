import { describe, expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import type { Library } from "./strings";
import { parseIcu, placeholderWrittenOf } from "./icu";
import { validateTranslation, type ValidationError } from "./validate";

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
    expect(unclosed.ok).toBe(false);
    expect(!unclosed.ok && unclosed.errors[0]?.code).toBe("invalid-icu");
    expect(errorsOf(source, "<i>{user}</i> {host}")).toEqual([
      { code: "unexpected-tag", name: "i" },
    ]);
  });
});

describe("android library", () => {
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
      "{n, plural, =1 {a} =1000000 {b} =2000000 {c} other {d}}",
      "es",
    ),
  ).toMatchObject({ incomplete: [{ key: "many" }] });
  // Spanish's many is a million and up: no =N covers it.
  expect(
    validateTranslation(source, "{n, plural, =1 {a} other {b}}", "es"),
  ).toMatchObject({
    incomplete: [{ code: "missing-category", arg: "n", key: "many" }],
  });
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
  // A language with categories still needs the count.
  expect(
    validateTranslation(
      "{count, plural, one {One post by {name}} other {Posts by {name}}}",
      "Beiträge von {name}",
      "de",
    ),
  ).toEqual({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
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
    "{n, plural, one {a {x} b} other {b}}",
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
    errors: [
      {
        code: "invalid-icu",
        where: "target",
        message: "plural needs an other branch",
      },
    ],
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
  expect(
    validateTranslation("Hi {name}", "Привет {наме}", "ru", "vue"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder" },
      { code: "unexpected-placeholder", name: "наме" },
    ],
  });
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
  // A plural object read as one string, its forms counterpart's.
  expect(
    validateTranslation(
      "{count, plural, one {%(count)s room} other {%(count)s rooms}}",
      "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi} other {%(count)s pokoju}}",
      "pl",
      lib,
    ),
  ).toEqual({ ok: true });
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
    placeholderWrittenOf(
      "{arg1, plural, one {%arg post} other {%lld posts}}",
      "printf",
    ).get("1"),
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
