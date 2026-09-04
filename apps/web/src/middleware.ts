import { NextResponse, type NextRequest } from "next/server";

// Cheap edge gate (§10): visitors without a session cookie are sent to
// the invite prompt. Actual session validity is checked server-side by
// requireUser()/currentUser() — the edge runtime cannot open SQLite.
const OPEN_PATHS = new Set(["/invite", "/api/health"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();
  if (request.cookies.has("corpus_session")) return NextResponse.next();
  return NextResponse.redirect(new URL("/invite", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
