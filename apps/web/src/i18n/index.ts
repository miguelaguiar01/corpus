// Corpus's own message catalog (spec §12): every user-facing chrome string
// lives in messages.{lang}.json — never as a literal in a component.
//
// How to add a string:
//   1. Add a flat dot-separated key to messages.en.json (the key is the
//      snapshot string ID — renaming a key is a delete + create, §4).
//   2. Use t("your.key") — an unknown key is a type error.
//   3. Message syntax is the ICU subset of §5, rendered by the contract's
//      own engine: {placeholder} interpolation, select and plural (pass
//      the values as the second argument; a plural picks its branch by
//      English's categories, since the chrome renders the source language).
//
// messages.pt-PT.json is the Portuguese catalogue the dogfood loop pulls
// back and rewrites through the writer (§12, §15); the chrome still
// renders the source language.
import { renderPreview } from "@corpus/contract";
import messages from "./messages.en.json";

export type MessageKey = keyof typeof messages;

export function t(
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const message = messages[key];
  if (values === undefined) return message;
  const strings = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, String(value)]),
  );
  const rendered = renderPreview(message, strings, "en", { capitalise: false });
  return rendered.ok ? rendered.text : message;
}
