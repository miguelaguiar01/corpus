import { describe, expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import type { Library } from "./strings";
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
    expect(
      errorsOf(
        PLURAL,
        "{n, plural, one {# mark} few {# marks} other {# marks}}",
        "en",
      ),
    ).toEqual([{ code: "unexpected-category", arg: "n", key: "few" }]);
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
        indexed: "%[n]s",
      },
      {
        code: "changed-verb",
        name: "2",
        expected: "%s",
        actual: "%d",
        indexed: "%[n]d",
      },
      {
        code: "changed-verb",
        name: "3",
        expected: "%f",
        actual: "%x",
        indexed: "%[n]x",
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
        indexed: "%[n]s",
      },
      {
        code: "changed-verb",
        name: "3",
        expected: "%s",
        actual: "%d",
        indexed: "%[n]d",
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
      },
      {
        code: "changed-verb",
        name: "2",
        expected: "%2$d",
        actual: "%s",
        indexed: "%n$s",
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
        indexed: "%[n]lu",
      },
    ]);
    expect(errorsOf("%ld items", "%d items", "pt-PT", "printf")).toEqual([
      {
        code: "changed-verb",
        name: "1",
        expected: "%ld",
        actual: "%d",
        indexed: "%[n]d",
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
  test("an attributed tag must come back with its attribute text verbatim; a void tag needs no close (#590)", () => {
    const source =
      'Read the <a href="%s" target="_blank">docs</a>.<br>Then go.';
    expect(
      validateTranslation(
        source,
        'Lê a <a href="%s" target="_blank">documentação</a>.<br/>Depois vai.',
      ),
    ).toEqual({ ok: true });
    expect(errorsOf(source, 'Lê a <a href="%s">documentação</a>.<br>')).toEqual(
      [
        { code: "missing-tag", name: 'a href="%s" target="_blank"' },
        { code: "unexpected-tag", name: 'a href="%s"' },
      ],
    );
    expect(
      errorsOf(source, 'Lê a <a href="%s" target="_blank">documentação</a>.'),
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
