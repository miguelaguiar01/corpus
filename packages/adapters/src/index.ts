// @corpus/adapters — pure functions mapping repo files ↔ snapshot entries
// (spec §2, §3). Pure: no I/O. Implementations arrive with M1.
export const BUILT_IN_ADAPTERS = ["messages", "table", "exec"] as const;
export type BuiltInAdapter = (typeof BUILT_IN_ADAPTERS)[number];
