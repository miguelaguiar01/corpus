// Insert a token at the caret (or over the selection) of a text field,
// returning the new text and where the caret should land. Pure, so the
// chip-insert behaviour is testable without a DOM.
export function insertAtCaret(
  text: string,
  start: number | null,
  end: number | null,
  token: string,
): { text: string; caret: number } {
  const from = start ?? text.length;
  const to = end ?? from;
  const next = text.slice(0, from) + token + text.slice(to);
  return { text: next, caret: from + token.length };
}
