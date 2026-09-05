"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  INVITE_PATH,
  inviteErrorPath,
  PASSWORD_PATH,
  SESSION_COOKIE,
} from "./constants";
import { RateLimiter } from "./rate-limit";
import { currentUser } from "./session";
import {
  createSession,
  endSession,
  joinInstance,
  SESSION_TTL_MS,
  setPassword,
  signIn,
} from "./service";

// Two layers (§10: rate-limit the sign-in and join forms): a per-client
// window for the friendly case, and a global cap so a rotated/spoofed
// x-forwarded-for cannot buy fresh budgets — the instance serves a
// handful of humans, so 30 failures/15min across all clients is
// generous. The global cap counts failures only, so one client cannot
// lock everyone out by submitting; the per-client window counts every
// attempt and is checked first. Module-level state survives across
// requests in the single server process.
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

async function limited(): Promise<boolean> {
  const requestHeaders = await headers();
  if (!clientLimiter.allow(clientKey(requestHeaders.get("x-forwarded-for")))) {
    return true;
  }
  return globalLimiter.blocked("invite");
}

function noteFailure(): void {
  globalLimiter.allow("invite");
}

async function startSession(userId: number, to: string): Promise<never> {
  const token = createSession(getDb(), userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  redirect(to);
}

export async function submitJoin(formData: FormData): Promise<void> {
  if (await limited()) redirect(inviteErrorPath("rate-limited"));
  const instanceSecret = process.env.CORPUS_INVITE_SECRET;
  if (!instanceSecret) {
    throw new Error("CORPUS_INVITE_SECRET is not configured");
  }
  const result = joinInstance(getDb(), {
    instanceSecret,
    providedSecret: String(formData.get("secret") ?? ""),
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) {
    noteFailure();
    redirect(
      inviteErrorPath(
        result.reason === "name-taken"
          ? "name-taken"
          : result.reason === "weak-password"
            ? "weak-password"
            : "invalid",
      ),
    );
  }
  await startSession(result.user.id, "/");
}

export async function submitSignIn(formData: FormData): Promise<void> {
  if (await limited()) redirect(inviteErrorPath("rate-limited"));
  const result = signIn(getDb(), {
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) {
    noteFailure();
    redirect(inviteErrorPath("credentials"));
  }
  await startSession(
    result.user.id,
    result.mustChangePassword ? PASSWORD_PATH : "/",
  );
}

export async function submitPassword(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect(INVITE_PATH);
  const result = setPassword(
    getDb(),
    user.id,
    String(formData.get("password") ?? ""),
  );
  if (!result.ok) redirect(`${PASSWORD_PATH}?error=weak-password`);
  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) endSession(getDb(), token);
  jar.delete(SESSION_COOKIE);
  redirect(INVITE_PATH);
}
