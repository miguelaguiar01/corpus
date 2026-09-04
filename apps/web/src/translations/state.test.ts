import { describe, expect, test } from "vitest";
import {
  transition,
  type TranslationRow,
  type TranslationState,
} from "./state";

const STATES: TranslationState[] = ["untranslated", "translated", "verified"];

function row(
  state: TranslationState,
  overrides: Partial<TranslationRow> = {},
): TranslationRow {
  return {
    state,
    stale: false,
    text: state === "untranslated" ? null : "Olá",
    archived: false,
    isSource: false,
    ...overrides,
  };
}

const anyone = { maintainer: false };
const maintainer = { maintainer: true };

describe("save", () => {
  test.each(STATES)("from %s → translated with the new text", (state) => {
    const result = transition(
      row(state),
      { type: "save", text: "Bom dia" },
      anyone,
    );
    expect(result).toEqual({
      row: {
        ...row(state),
        state: "translated",
        text: "Bom dia",
        stale: false,
      },
    });
  });

  test.each(STATES)("from stale %s clears stale", (state) => {
    const result = transition(
      row(state, { stale: true }),
      { type: "save", text: "Bom dia" },
      anyone,
    );
    expect(result).toMatchObject({
      row: { state: "translated", stale: false },
    });
  });

  test("does not require maintainer", () => {
    const result = transition(
      row("verified"),
      { type: "save", text: "x" },
      anyone,
    );
    expect(result).toMatchObject({ row: { state: "translated" } });
  });

  test.each(STATES)(
    "on an archived-string row from %s is rejected",
    (state) => {
      const result = transition(
        row(state, { archived: true }),
        { type: "save", text: "x" },
        maintainer,
      );
      expect(result).toEqual({ error: "archived" });
    },
  );

  test.each(["", "   ", "\n"])("with blank text %j is rejected", (text) => {
    const result = transition(
      row("untranslated"),
      { type: "save", text },
      anyone,
    );
    expect(result).toEqual({ error: "empty-text" });
  });
});

describe("the source row", () => {
  test.each(STATES)(
    "rejects save from %s: its text comes from the repo",
    (state) => {
      const result = transition(
        row(state, { isSource: true }),
        { type: "save", text: "x" },
        maintainer,
      );
      expect(result).toEqual({ error: "source-row" });
    },
  );

  test("still accepts verify by a maintainer", () => {
    const result = transition(
      row("translated", { isSource: true }),
      { type: "verify" },
      maintainer,
    );
    expect(result).toMatchObject({ row: { state: "verified" } });
  });
});

describe("verify", () => {
  test.each(["translated", "verified"] as const)(
    "from %s by a maintainer → verified",
    (state) => {
      const result = transition(row(state), { type: "verify" }, maintainer);
      expect(result).toEqual({
        row: { ...row(state), state: "verified", stale: false },
      });
    },
  );

  test.each(["translated", "verified"] as const)(
    "from stale %s clears stale",
    (state) => {
      const result = transition(
        row(state, { stale: true }),
        { type: "verify" },
        maintainer,
      );
      expect(result).toMatchObject({
        row: { state: "verified", stale: false },
      });
    },
  );

  test.each(STATES)("from %s by a non-maintainer is rejected", (state) => {
    const result = transition(row(state), { type: "verify" }, anyone);
    expect(result).toEqual({ error: "not-maintainer" });
  });

  test("on an archived-string row rejects as archived before checking the actor", () => {
    const result = transition(
      row("translated", { archived: true }),
      { type: "verify" },
      anyone,
    );
    expect(result).toEqual({ error: "archived" });
  });

  test("from untranslated is rejected — there is nothing to sign off", () => {
    const result = transition(
      row("untranslated"),
      { type: "verify" },
      maintainer,
    );
    expect(result).toEqual({ error: "untranslated" });
  });

  test.each(STATES)(
    "on an archived-string row from %s is rejected",
    (state) => {
      const result = transition(
        row(state, { archived: true }),
        { type: "verify" },
        maintainer,
      );
      expect(result).toEqual({ error: "archived" });
    },
  );
});

describe("purity", () => {
  test("never mutates the input row", () => {
    const input = row("translated", { stale: true });
    const snapshot = { ...input };
    transition(input, { type: "save", text: "novo" }, anyone);
    transition(input, { type: "verify" }, maintainer);
    expect(input).toEqual(snapshot);
  });
});
