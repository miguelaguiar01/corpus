import { NextResponse, type NextRequest } from "next/server";
import { INVITE_PATH, SESSION_COOKIE, SESSION_TTL_MS } from "@/auth/constants";

// Cheap edge gate (§10; Next 16 calls this file the proxy): visitors
// without a session cookie are sent to the invite prompt. Actual session validity is checked server-side by
// requireUser()/currentUser() — the edge runtime cannot open SQLite.
// /api/* routes are machine endpoints that carry their own auth (bearer
// token, or public like /api/health), so the cookie gate must not touch
// them — otherwise the CLI gets redirected to the invite page.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === INVITE_PATH || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    // Behind a proxy the Host header is whatever the proxy forwards;
    // CORPUS_PUBLIC_URL pins the origin the redirect names.
    const origin = process.env.CORPUS_PUBLIC_URL || request.url;
    return NextResponse.redirect(new URL(INVITE_PATH, origin));
  }
  // The row's expiry slides on use (service); the cookie's has to slide
  // here, on every page request, or the browser drops a live session at
  // ninety days after sign-in.
  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
