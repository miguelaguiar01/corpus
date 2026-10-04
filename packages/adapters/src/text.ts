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
    if (!e.startsWith("#"))
      return Object.hasOwn(ENTITIES, e) ? ENTITIES[e]! : whole;
    const code = e.startsWith("#x")
      ? parseInt(e.slice(2), 16)
      : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// A copy no lookup reaches Object.prototype through: an id named
// `toString` is one the map holds or lacks like any other (#845).
export function ownRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, record);
}

// Where the text is used, as a note's last line: gettext's `#:`, Qt's
// `<location>`s, XLIFF's context groups.
export function usedIn(locations: string[]): string[] {
  return locations.length ? [`Used in ${locations.join(" ")}`] : [];
}

// A file's text by its bytes (#1037): UTF-16 where a byte-order mark says
// so, as Xcode may write a `.strings` file, UTF-8 otherwise; the mark is
// kept in the text, and a write takes the encoding the read found.
export type TextEncoding = "utf8" | "utf16le" | "utf16be";

export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: TextEncoding;
} {
  const encoding: TextEncoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf16be"
        : "utf8";
  if (encoding === "utf8")
    return {
      text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
      encoding,
    };
  // Code unit by code unit: a runtime's decoder may lack UTF-16BE.
  const units: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const [a, b] = [bytes[i]!, bytes[i + 1]!];
    units.push(
      String.fromCharCode(encoding === "utf16le" ? a | (b << 8) : (a << 8) | b),
    );
  }
  const text = units.join("");
  return { text, encoding };
}

export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === "utf8") return new TextEncoder().encode(text);
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const [first, second] =
      encoding === "utf16le"
        ? [unit & 0xff, unit >> 8]
        : [unit >> 8, unit & 0xff];
    out[i * 2] = first;
    out[i * 2 + 1] = second;
  }
  return out;
}
