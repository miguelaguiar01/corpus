// What a refused save carries back to the string page (#529, #1058):
// the draft, and the version the translator opened it at, so the next
// save still warns of an edit made in between. Both ride back only
// beside the refusal or warning that carried them; a bare link's are
// ignored.
type Carrying = {
  error?: string | string[];
  warning?: string | string[];
  draft?: string | string[];
  opened?: string | string[];
};

export function carriedFrom(
  query: Carrying,
  rowVersion: number,
): { draft?: string; openedVersion: number } {
  if (typeof query.draft !== "string" || !(query.error || query.warning))
    return { openedVersion: rowVersion };
  const opened =
    typeof query.opened === "string" && /^\d+$/.test(query.opened)
      ? Number(query.opened)
      : rowVersion;
  return {
    draft: query.draft,
    openedVersion: Number.isSafeInteger(opened) ? opened : rowVersion,
  };
}
