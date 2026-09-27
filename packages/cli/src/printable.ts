const ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

// An id or key as text output prints it (#648): gettext msgids span
// lines, and a finding is one line. `--json` keeps the raw string.
export function printable(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex -- the control characters are the point
    /[\u0000-\u001f\u007f\u2028\u2029]/g,
    (ch) =>
      ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
