export const CLI_NAME = "corpus" as const;

export { run, type RunContext } from "./cli";
export { loadConfig, requireToken, CliError } from "./config";
