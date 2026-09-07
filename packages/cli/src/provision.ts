import { chmodSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CorpusConfig } from "@corpus/contract";
import { CONFIG_FILENAMES } from "./config";
import { CORPUS_DIR, TOKEN_FILE, tokenPath } from "./corpus-dir";
import { requestProject } from "./project";

// The workbench's start in a repository with a config and no token
// (§2): the declared project is created with the instance secret and
// its token written beside it, so push works in the next shell.
export function wantsProvision(cwd: string, args: string[]): boolean {
  if (args.includes("--no-provision")) return false;
  if (existsSync(tokenPath(cwd))) return false;
  return CONFIG_FILENAMES.some((name) => existsSync(path.join(cwd, name)));
}

export async function provision(
  cwd: string,
  url: string,
  secret: string,
  config: CorpusConfig,
): Promise<string> {
  const result = await requestProject(url, secret, {
    slug: config.project,
    name: config.project,
    sourceLanguage: config.sourceLanguage,
    languages: config.languages,
  });
  const file = `${CORPUS_DIR}/${TOKEN_FILE}`;
  if (result.ok) {
    writeFileSync(tokenPath(cwd), `${result.token}\n`, { mode: 0o600 });
    chmodSync(tokenPath(cwd), 0o600);
    return `token     written to ${file} (project ${result.slug} created)`;
  }
  if (result.status === 409) {
    return `token     project ${config.project} exists here and ${file} is missing; rotate its token at ${url}/p/${config.project}/settings and save it to ${file}`;
  }
  return `token     not written: project ${config.project} could not be created (HTTP ${result.status}${result.message ? `: ${result.message}` : ""})`;
}
