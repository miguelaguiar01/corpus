import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RunContext } from "./cli";
import { option } from "./args";
import { CliError, loadConfig, readToken } from "./config";
import { serverMessage } from "./server";
import {
  CORPUS_DIR,
  SECRET_FILE,
  secretPath,
  TOKEN_FILE,
  tokenPath,
} from "./corpus-dir";

export const PROJECT_USAGE =
  "corpus project create [--name <name>] [--server <url>] | corpus project rotate-token [--server <url>]";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(server: string): boolean {
  try {
    return LOOPBACK.has(new URL(server).hostname);
  } catch {
    return false;
  }
}

// The instance secret (§10): the env var, or the local workbench's own
// file when the server is this machine; a remote instance's secret is
// never guessed from a local file.
export function requireSecret(
  env: NodeJS.ProcessEnv,
  cwd: string,
  server: string,
): string {
  if (env.CORPUS_INVITE_SECRET) return env.CORPUS_INVITE_SECRET;
  const file = secretPath(cwd);
  if (isLoopback(server) && existsSync(file)) {
    const secret = readFileSync(file, "utf8").trim();
    if (secret) return secret;
    throw new CliError(`${CORPUS_DIR}/${SECRET_FILE} is empty`);
  }
  throw new CliError(
    `CORPUS_INVITE_SECRET is not set (the instance secret; a local workbench keeps it in ${CORPUS_DIR}/${SECRET_FILE})`,
  );
}

// The config declares the project's languages once, at creation; after
// that the maintainer corner owns them and push only names the drift
// (§8), on one line.
export function languageDrift(
  declared: string[],
  actual: string[],
): string | undefined {
  const parts: string[] = [];
  const missing = declared.filter((l) => !actual.includes(l));
  const extra = actual.filter((l) => !declared.includes(l));
  if (missing.length > 0) {
    parts.push(
      `the config declares ${missing.join(", ")}, which the project does not have`,
    );
  }
  if (extra.length > 0) {
    parts.push(
      `the project has ${extra.join(", ")}, which the config does not declare`,
    );
  }
  if (parts.length === 0) return undefined;
  return `${parts.join("; ")}; languages are changed in the project's settings`;
}

export async function project(
  args: string[],
  ctx: RunContext,
): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "create") return create(rest, ctx);
  if (sub === "rotate-token") return rotateToken(rest, ctx);
  throw new CliError(`usage: ${PROJECT_USAGE}`);
}

type Created = { slug: string; token: string };

type RequestResult =
  ({ ok: true } & Created) | { ok: false; status: number; detail: string };

// The creation request (§10), for the command and for the workbench's
// own start; the caller words the outcome.
export async function requestProject(
  server: string,
  secret: string,
  input: {
    slug: string;
    name: string;
    sourceLanguage: string;
    languages: string[];
  },
): Promise<RequestResult> {
  const response = await post(`${server}/api/projects`, secret, input);
  if (response.ok) return { ok: true, ...((await response.json()) as Created) };
  return {
    ok: false,
    status: response.status,
    detail: await serverMessage(response),
  };
}

// `corpus project create` (§3): the config's project, provisioned with
// the instance secret; the token alone on stdout's last line.
async function create(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const server = serverOf(args, config.server);
  const secret = requireSecret(ctx.env, ctx.cwd, server);
  const result = await requestProject(server, secret, {
    slug: config.project,
    name: option(args, "--name") ?? config.project,
    sourceLanguage: config.sourceLanguage,
    languages: config.languages,
  });
  if (!result.ok) {
    if (result.status === 409) {
      throw new CliError(
        `project ${config.project} already exists on ${server}; a maintainer rotates its token in the project's settings, or corpus project rotate-token with the current one`,
      );
    }
    if (result.status === 401) {
      throw new CliError(`the instance secret was refused by ${server}`);
    }
    throw new CliError(
      `project create failed (HTTP ${result.status})${result.detail}`,
    );
  }
  ctx.err(`corpus: created project ${result.slug} on ${server}`);
  ctx.out(result.token);
  return 0;
}

// `corpus project rotate-token` (§3): the current token replaces itself;
// .corpus/token follows when it is where the old one came from.
async function rotateToken(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const server = serverOf(args, config.server);
  const current = readToken(ctx.env, ctx.cwd);
  const response = await post(
    `${server}/api/projects/${config.project}/token`,
    current.token,
  );
  if (response.status === 401 || response.status === 403) {
    throw new CliError(
      `the current token was refused by ${server} for ${config.project}`,
    );
  }
  if (!response.ok) {
    throw new CliError(
      `rotate-token failed (HTTP ${response.status})${await serverMessage(response)}`,
    );
  }
  const rotated = (await response.json()) as Created;
  if (current.source === "file") {
    writeFileSync(tokenPath(ctx.cwd), `${rotated.token}\n`, { mode: 0o600 });
    chmodSync(tokenPath(ctx.cwd), 0o600);
    ctx.err(
      `corpus: rotated the token of ${config.project}; ${CORPUS_DIR}/${TOKEN_FILE} updated`,
    );
  } else {
    ctx.err(`corpus: rotated the token of ${config.project}`);
  }
  ctx.out(rotated.token);
  return 0;
}

function serverOf(args: string[], fallback: string): string {
  return (option(args, "--server") ?? fallback).replace(/\/$/, "");
}

async function post(
  url: string,
  bearer: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new CliError(
      `could not reach the server at ${url}: ${(error as Error).message}`,
    );
  }
}
