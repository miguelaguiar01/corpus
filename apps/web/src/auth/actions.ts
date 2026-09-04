"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { RateLimiter } from "./rate-limit";
import { createSession, redeemInvite, SESSION_TTL_MS } from "./service";
import { SESSION_COOKIE } from "./session";

// 5 attempts per 15 minutes per client (§10: rate-limit the invite
// endpoint). Module-level state survives across requests in the single
// server process.
const limiter = new RateLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

function clientKey(forwardedFor: string | null): string {
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export async function submitInvite(formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  if (!limiter.allow(clientKey(requestHeaders.get("x-forwarded-for")))) {
    redirect("/invite?error=rate-limited");
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
    redirect("/invite?error=invalid");
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
