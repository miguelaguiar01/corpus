import { CliError } from "./config";

export const UNAUTHORIZED =
  "unauthorized — the token was refused (CORPUS_TOKEN or .corpus/token, for this project)";

// One request to the instance with a bearer credential; an unreachable
// server is a CliError naming it, never a stack trace.
export async function request(
  url: string,
  bearer: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new CliError(
      `could not reach the server at ${new URL(url).origin}: ${(error as Error).message}`,
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
