import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeText, encodeText, type TextEncoding } from "@corpus/adapters";

// A repository file's text, UTF-16 where its byte-order mark says so
// (#1037): a write keeps the encoding the read found, and a new file
// takes its template's.
const ENCODING = new Map<string, TextEncoding>();

export function readRepoText(abs: string): string {
  const { text, encoding } = decodeText(readFileSync(abs));
  if (encoding !== "utf8") ENCODING.set(abs, encoding);
  return text;
}

export function readRepoTextIfAny(abs: string): string | undefined {
  return existsSync(abs) ? readRepoText(abs) : undefined;
}

export function writeRepoText(abs: string, text: string, like?: string): void {
  const encoding =
    ENCODING.get(abs) ?? (like !== undefined ? ENCODING.get(like) : undefined);
  if (encoding) ENCODING.set(abs, encoding);
  writeFileSync(abs, encodeText(text, encoding ?? "utf8"));
}
