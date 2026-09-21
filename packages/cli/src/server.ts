import { gzipSync } from "node:zlib";
import { CliError } from "./config";

// A body from this size on travels gzipped: a repository's catalogue
// with its translations as seeds is megabytes of JSON that shrink
// tenfold, and the server inflates under its own cap.
export const GZIP_FROM_BYTES = 256 * 1024;

export const UNAUTHORIZED =
  "unauthorized — the token was refused (CORPUS_TOKEN or .corpus/token, for this project)";

// One request to the instance with a bearer credential; an unreachable
// server is a CliError naming it, never a stack trace.
export async function request(
  url: string,
  bearer: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<Response> {
  const json = init.body === undefined ? undefined : JSON.stringify(init.body);
  const gzip = json !== undefined && Buffer.byteLength(json) >= GZIP_FROM_BYTES;
  try {
    return await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...(gzip ? { "content-encoding": "gzip" } : {}),
      },
      body: json === undefined ? undefined : gzip ? gzipSync(json) : json,
    });
  } catch (error) {
    throw new CliError(
      `could not reach the server at ${url}: ${(error as Error).message}`,
    );
  }
}

// The server's message body for an otherwise-unhandled non-2xx, if any.
export async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `: ${body.message}` : "";
  } catch {
    return "";
  }
}
