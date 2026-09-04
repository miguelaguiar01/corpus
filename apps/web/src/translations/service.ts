// State transition service (§11): applies one save/verify action to a
// string × language row and appends the edit-log entry, in a single
// transaction. The state logic lives in the pure machine; this is the
// I/O shell around it.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { edits, strings, stringTranslations } from "@/db/schema";
import {
  transition,
  type Actor,
  type TransitionError,
  type TranslationAction,
} from "./state";
import { changedSinceOpened } from "./version";

export type TranslationRecord = typeof stringTranslations.$inferSelect;
export type EditRecord = typeof edits.$inferSelect;

export type ApplyInput = {
  stringId: number;
  language: string;
  action: TranslationAction;
  actor: Actor & { id: number };
  // The version token the editor opened with (see version.ts); optional,
  // and never blocks the write.
  openedVersion?: number;
};

export type ApplyResult =
  | { row: TranslationRecord; edit: EditRecord; changedSinceOpened: boolean }
  | { error: TransitionError | "not-found" };

export function applyTransition(db: Db, input: ApplyInput): ApplyResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ row: stringTranslations, archived: strings.archived })
      .from(stringTranslations)
      .innerJoin(strings, eq(strings.id, stringTranslations.stringId))
      .where(
        and(
          eq(stringTranslations.stringId, input.stringId),
          eq(stringTranslations.language, input.language),
        ),
      )
      .get();
    if (!current) return { error: "not-found" };

    const result = transition(
      {
        state: current.row.state,
        stale: current.row.stale,
        text: current.row.text,
        archived: current.archived,
      },
      input.action,
      input.actor,
    );
    if ("error" in result) return result;

    const [row] = tx
      .update(stringTranslations)
      .set({
        state: result.row.state,
        text: result.row.text,
        stale: result.row.stale,
        updatedAt: new Date(),
      })
      .where(eq(stringTranslations.id, current.row.id))
      .returning()
      .all();
    const [edit] = tx
      .insert(edits)
      .values({
        stringId: input.stringId,
        language: input.language,
        userId: input.actor.id,
        oldText: current.row.text,
        newText: result.row.text,
        oldState: current.row.state,
        newState: result.row.state,
      })
      .returning()
      .all();
    if (!row || !edit) throw new Error("transition wrote no rows");
    return {
      row,
      edit,
      changedSinceOpened: changedSinceOpened(
        input.openedVersion,
        current.row.updatedAt,
      ),
    };
  });
}
