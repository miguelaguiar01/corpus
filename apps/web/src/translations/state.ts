// Per string × language state machine (§11), pure: row + action + actor →
// next row or a typed rejection. The transition service (#86) applies the
// result and logs it; nothing here touches the DB.
//
// `untranslated → translated → verified`, with `stale` as an overlay that
// only push sets (ingest) and only save/verify clear. The source language
// uses the same row type: it starts at `translated`, and verify is the
// proofreading sign-off.

export type TranslationState = "untranslated" | "translated" | "verified";

export type TranslationRow = {
  state: TranslationState;
  stale: boolean;
  text: string | null;
  // The parent string's archived flag: archived strings are read-only.
  archived: boolean;
  // The source-language row: its text is the repo's (§8), so it can be
  // verified (proofread) but never saved here.
  isSource: boolean;
};

export type TranslationAction =
  { type: "save"; text: string } | { type: "verify" };

export type Actor = { maintainer: boolean };

export type TransitionError =
  "archived" | "empty-text" | "not-maintainer" | "source-row" | "untranslated";

export type TransitionResult =
  { row: TranslationRow } | { error: TransitionError };

export function transition(
  row: TranslationRow,
  action: TranslationAction,
  actor: Actor,
): TransitionResult {
  if (row.archived) return { error: "archived" };

  switch (action.type) {
    case "save":
      if (row.isSource) return { error: "source-row" };
      if (action.text.trim() === "") return { error: "empty-text" };
      return {
        row: { ...row, state: "translated", text: action.text, stale: false },
      };
    case "verify":
      if (!actor.maintainer) return { error: "not-maintainer" };
      if (row.state === "untranslated") return { error: "untranslated" };
      return { row: { ...row, state: "verified", stale: false } };
  }
}
