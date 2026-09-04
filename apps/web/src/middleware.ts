import { NextResponse, type NextRequest } from "next/server";
import { INVITE_PATH, SESSION_COOKIE } from "@/auth/constants";

// Cheap edge gate (§10): visitors without a session cookie are sent to
// the invite prompt. Actual session validity is checked server-side by
// requireUser()/currentUser() — the edge runtime cannot open SQLite.
// /api/* routes are machine endpoints that carry their own auth (bearer
// token, or public like /api/health), so the cookie gate must not touch
// them — otherwise the CLI gets redirected to the invite page.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === INVITE_PATH || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL(INVITE_PATH, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
