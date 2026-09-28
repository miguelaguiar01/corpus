// A note as the repository writes it, its line breaks kept: a gettext,
// qt-ts or xliff note puts where the text is used on a line of its own
// (#790).
export function NoteText({ text }: { text: string }) {
  return <p className="text-sm whitespace-pre-line">{text}</p>;
}
