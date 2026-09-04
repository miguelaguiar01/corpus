import type { TranslationState } from "./state";

// Whether the verify action is shown for a row (§9.3): maintainers only,
// only a translated row has something to sign off, and archived strings
// are read-only. The state machine enforces the same server-side.
export function canVerifyRow(
  user: { maintainer: boolean } | undefined,
  row: { state: TranslationState; archived: boolean },
): boolean {
  return (
    user?.maintainer === true && row.state === "translated" && !row.archived
  );
}
