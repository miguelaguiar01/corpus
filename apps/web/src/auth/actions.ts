"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { inviteErrorPath, SESSION_COOKIE } from "./constants";
import { RateLimiter } from "./rate-limit";
import { createSession, redeemInvite, SESSION_TTL_MS } from "./service";

// Two layers (§10: rate-limit the invite endpoint; review finding on
// PR #25): a per-client window for the friendly case, and a global cap
// so a rotated/spoofed x-forwarded-for cannot buy fresh budgets — the
// instance serves a handful of humans, so 30 attempts/15min across all
// clients is generous. Module-level state survives across requests in
// the single server process.
const WINDOW_MS = 15 * 60 * 1000;
const clientLimiter = new RateLimiter({
  max: 5,
  windowMs: WINDOW_MS,
  maxKeys: 1000,
});
const globalLimiter = new RateLimiter({ max: 30, windowMs: WINDOW_MS });

// Only the first x-forwarded-for hop; entirely client-controlled without
// a proxy, which is why the global limiter must also consume.
function clientKey(forwardedFor: string | null): string {
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function submitInvite(formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  const perClientOk = clientLimiter.allow(
    clientKey(requestHeaders.get("x-forwarded-for")),
  );
  if (!globalLimiter.allow("invite") || !perClientOk) {
    redirect(inviteErrorPath("rate-limited"));
  }

  const instanceSecret = process.env.CORPUS_INVITE_SECRET;
  if (!instanceSecret) {
    throw new Error("CORPUS_INVITE_SECRET is not configured");
  }

  const name = String(formData.get("name") ?? "");
  const providedSecret = String(formData.get("secret") ?? "");
  const result = redeemInvite(getDb(), {
    instanceSecret,
    providedSecret,
    name,
  });
  if (!result.ok) {
    redirect(inviteErrorPath("invalid"));
  }

  const token = createSession(getDb(), result.user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  redirect("/");
}
