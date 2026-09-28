// Helpers the file adapters share (#818): patches spliced into a file's
// text, its line ends and indentation, and XML's comments, attributes
// and entities.

export type Span = { start: number; end: number };
export type Patch = Span & { text: string };

// The text with each patch's span replaced, in one pass; patches never
// overlap, and two at one place keep the order they came in.
export function applied(text: string, patches: Patch[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const p of [...patches].sort((a, b) => a.start - b.start)) {
    parts.push(text.slice(at, p.start), p.text);
    at = p.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}

export function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// The indentation of the line `at` is on.
export function lineIndent(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
}

// XML comments masked, so nothing inside one is read as an element, at
// the same offsets.
export function masked(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

// An attribute's value, in either quote.
export function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)?.[2];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

// XML's five named entities and its character references decoded; a
// reference to no character, and any other name, kept as written.
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) => {
    if (!e.startsWith("#")) return ENTITIES[e] ?? whole;
    const code = e.startsWith("#x")
      ? parseInt(e.slice(2), 16)
      : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// Where the text is used, as a note's last line: gettext's `#:`, Qt's
// `<location>`s, XLIFF's context groups.
export function usedIn(locations: string[]): string[] {
  return locations.length ? [`Used in ${locations.join(" ")}`] : [];
}
