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

test("a page with a session cookie passes through", () => {
  const res = middleware(request("/p/moonlight", true));
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

test("the redirect goes to the host the visitor used", () => {
  // The standalone server reports its bind address in request.url, not
  // the visitor's host; a redirect built from it would send a visitor of
  // corpus.example.com to localhost.
  const req = new NextRequest("http://localhost:3000/p/moonlight?x=1", {
    headers: { host: "corpus.example.com" },
  });
  const res = middleware(req);
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("http://corpus.example.com/invite");
});
