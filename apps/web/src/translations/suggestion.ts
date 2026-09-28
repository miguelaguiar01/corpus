// The suggestion a row's editor offers: the repository's, a gettext
// fuzzy row (#721, #773), only while the row has no translation (#774).
export function suggestionOf(row: {
  state: string;
  suggestion: string | null;
}): string | null {
  return row.state === "untranslated" && row.suggestion ? row.suggestion : null;
}
