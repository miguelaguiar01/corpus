import { RateLimiter } from "@/auth/rate-limit";
import { secretsMatch } from "@/auth/service";
import { bearerToken } from "./bearer";

export type SecretAuth = { ok: true } | { ok: false; response: Response };

type Limits = { max: number; windowMs: number; globalMax: number };

const WINDOW_MS = 15 * 60 * 1000;

// The instance secret as the headless maintainer credential (§10):
// whoever holds it can join as the maintainer, so presenting it as a
// bearer token may provision a project. The same two-layer limiter as
// the join form, counting failures only; the per-client key is the
// first x-forwarded-for hop, which the global cap keeps honest.
export function secretGate(
  limits: Limits = { max: 10, windowMs: WINDOW_MS, globalMax: 30 },
) {
  const clientLimiter = new RateLimiter({
    max: limits.max,
    windowMs: limits.windowMs,
    maxKeys: 1000,
  });
  const globalLimiter = new RateLimiter({
    max: limits.globalMax,
    windowMs: limits.windowMs,
  });

  return function authenticateInstanceSecret(
    request: Request,
    instanceSecret: string | undefined = process.env.CORPUS_INVITE_SECRET,
  ): SecretAuth {
    if (!instanceSecret) {
      throw new Error("CORPUS_INVITE_SECRET is not configured");
    }
    const client =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const wait = Math.max(
      clientLimiter.retryAfterMs(client),
      globalLimiter.retryAfterMs("secret"),
    );
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return {
        ok: false,
        response: Response.json(
          {
            error: "rate-limited",
            message: `too many failed attempts; retry in ${seconds}s`,
          },
          { status: 429, headers: { "retry-after": String(seconds) } },
        ),
      };
    }
    const provided = bearerToken(request.headers.get("authorization"));
    if (!provided || !secretsMatch(instanceSecret, provided)) {
      clientLimiter.allow(client);
      globalLimiter.allow("secret");
      return {
        ok: false,
        response: Response.json(
          { error: "unauthorized", message: "invalid instance secret" },
          { status: 401 },
        ),
      };
    }
    return { ok: true };
  };
}

export const authenticateInstanceSecret = secretGate();
