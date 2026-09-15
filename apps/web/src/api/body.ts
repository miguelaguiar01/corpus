import type { ZodType } from "zod";
import { MAX_PROJECT_BODY_BYTES } from "./limits";

export type BodyResult<T> =
  { ok: true; value: T } | { ok: false; response: Response };

export function apiError(
  status: number,
  error: string,
  message: string,
): Response {
  return Response.json({ error, message }, { status });
}

// A small JSON body under the project cap (§10), parsed and checked
// against its schema; the token routes share one reading of it.
export async function readBody<T>(
  request: Request,
  schema: ZodType<T>,
  cap = MAX_PROJECT_BODY_BYTES,
): Promise<BodyResult<T>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  const tooLarge = () =>
    apiError(413, "payload-too-large", `body exceeds ${cap} bytes`);
  if (declared > cap) return { ok: false, response: tooLarge() };
  const text = await request.text();
  if (Buffer.byteLength(text) > cap) return { ok: false, response: tooLarge() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: apiError(400, "bad-request", "body is not valid JSON"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      response: apiError(
        422,
        "invalid",
        `${where}${issue?.message ?? "invalid body"}`,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}
