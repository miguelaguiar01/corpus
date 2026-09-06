import { SESSION_COOKIE } from "@/auth/constants";
import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { proxy } from "./proxy";

function request(path: string, withCookie = false) {
  const req = new NextRequest(`http://corpus.test${path}`);
  if (withCookie) req.cookies.set("corpus_session", "tok");
  return req;
}

test("a page without a session redirects to /invite", () => {
  const res = proxy(request("/p/moonlight"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/invite");
});

test("a page with a session cookie passes through and re-issues the cookie", () => {
  const res = proxy(request("/p/moonlight", true));
  const reissued = res.headers.get("set-cookie") ?? "";
  expect(reissued).toContain(`${SESSION_COOKIE}=`);
  expect(reissued).toMatch(/Max-Age=7776000/);
  expect(res.headers.get("location")).toBeNull();
});

test("the redirect names CORPUS_PUBLIC_URL when it is set", () => {
  process.env.CORPUS_PUBLIC_URL = "https://corpus.example";
  try {
    const res = proxy(request("/p/moonlight"));
    expect(res.headers.get("location")).toBe("https://corpus.example/invite");
  } finally {
    delete process.env.CORPUS_PUBLIC_URL;
  }
});

test("/invite is always open", () => {
  const res = proxy(request("/invite"));
  expect(res.headers.get("location")).toBeNull();
});

test.each(["/api/push", "/api/health", "/api/push?dryRun"])(
  "%s is not cookie-gated (machine endpoints self-authenticate)",
  (path) => {
    const res = proxy(request(path));
    expect(res.headers.get("location")).toBeNull();
  },
);
