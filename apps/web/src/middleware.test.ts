import { SESSION_COOKIE } from "@/auth/constants";
import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { middleware } from "./middleware";

function request(path: string, withCookie = false) {
  const req = new NextRequest(`http://corpus.test${path}`);
  if (withCookie) req.cookies.set("corpus_session", "tok");
  return req;
}

test("a page without a session redirects to /invite", () => {
  const res = middleware(request("/p/moonlight"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/invite");
});

test("a page with a session cookie passes through and re-issues the cookie", () => {
  const res = middleware(request("/p/moonlight", true));
  const reissued = res.headers.get("set-cookie") ?? "";
  expect(reissued).toContain(`${SESSION_COOKIE}=`);
  expect(reissued).toMatch(/Max-Age=7776000/);
  expect(res.headers.get("location")).toBeNull();
});

test("/invite is always open", () => {
  const res = middleware(request("/invite"));
  expect(res.headers.get("location")).toBeNull();
});

test.each(["/api/push", "/api/health", "/api/push?dryRun"])(
  "%s is not cookie-gated (machine endpoints self-authenticate)",
  (path) => {
    const res = middleware(request(path));
    expect(res.headers.get("location")).toBeNull();
  },
);
