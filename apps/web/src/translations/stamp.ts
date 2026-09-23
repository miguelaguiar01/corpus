// A short stamp of the source text a page was opened with, carried by
// the save form so a push that moved the source underneath a draft is
// named rather than refused as a mystery (#529). Not a hash for
// integrity: two texts that collide only lose the warning.
export function sourceStamp(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
