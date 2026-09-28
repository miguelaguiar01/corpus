export const BUILT_IN_ADAPTERS = ["messages", "table", "exec"] as const;
export type BuiltInAdapter = (typeof BUILT_IN_ADAPTERS)[number];

export * from "./messages";
export * from "./table";
export * from "./write";
export * from "./android";
export * from "./fluent";
export * from "./xliff";
export * from "./gettext";
export * from "./xcstrings";
export * from "./qtts";
export * from "./qtnumerus";
