import { describe, expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import { validateTranslation, type ValidationError } from "./validate";

const SIGHTING = moonlightManor.strings[0]!.source;

function errorsOf(
  source: string,
  target: string,
  language?: string,
): ValidationError[] {
  const result = validateTranslation(source, target, language);
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
    expect(
      errorsOf(PLURAL, "{n, plural, one {# метка} other {# меток}}", "ru"),
    ).toEqual([
      { code: "missing-category", arg: "n", key: "few" },
      { code: "missing-category", arg: "n", key: "many" },
    ]);
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
