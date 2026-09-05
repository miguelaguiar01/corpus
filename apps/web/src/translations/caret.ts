// Insert a token at the caret (or over the selection) of a text field,
// returning the new text and where the caret should land: after the
// token, or `caretOffset` characters into it (inside a select's first
// branch). Pure, so the chip-insert behaviour is testable without a DOM.
export function insertAtCaret(
  text: string,
  start: number | null,
  end: number | null,
  token: string,
  caretOffset = token.length,
): { text: string; caret: number } {
  const from = start ?? text.length;
  const to = end ?? from;
  const next = text.slice(0, from) + token + text.slice(to);
  return { text: next, caret: from + caretOffset };
}
