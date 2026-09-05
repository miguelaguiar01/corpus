export const CLI_NAME = "corpus" as const;

// What a client project's corpus.config.ts imports (§3): the config
// helper and its type, so the CLI is the only package to install.
export { defineCorpus, type CorpusConfig } from "@corpus/contract";

export { run, type RunContext } from "./cli";
export { loadConfig, requireToken, CliError } from "./config";
export { buildSnapshot } from "./build";
