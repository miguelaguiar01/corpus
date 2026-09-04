export const BUILT_IN_ADAPTERS = ["messages", "table", "exec"] as const;
export type BuiltInAdapter = (typeof BUILT_IN_ADAPTERS)[number];

export * from "./messages";
