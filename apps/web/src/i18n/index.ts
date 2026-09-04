// Corpus's own message catalog (spec §12): every user-facing chrome string
// lives in messages.{lang}.json — never as a literal in a component.
//
// How to add a string:
//   1. Add a flat dot-separated key to messages.en.json (the key is the
//      snapshot string ID — renaming a key is a delete + create, §4).
//   2. Use t("your.key") — an unknown key is a type error.
//   3. Message syntax is restricted to the ICU subset of §5: {placeholder}
//      interpolation (pass values as the second argument). `select` support
//      is added when a chrome string first needs it.
//
// messages.pt-PT.json is produced by `corpus pull` once the dogfood loop
// exists (M4) — never edited by hand. Chrome renders the source language
// until then.
import messages from "./messages.en.json";

export type MessageKey = keyof typeof messages;

export function t(
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const message = messages[key];
  if (values === undefined) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
