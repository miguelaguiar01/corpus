import { expect, test } from "vitest";
import { secureCookie } from "./cookie";

test("plain http on loopback gets no Secure attribute", () => {
  expect(secureCookie("localhost:3000", null)).toBe(false);
  expect(secureCookie("127.0.0.1:3919", null)).toBe(false);
  expect(secureCookie("[::1]:3000", null)).toBe(false);
  expect(secureCookie("LOCALHOST", null)).toBe(false);
});

test("HTTPS gets Secure wherever it is, by the proxy header or the URL", () => {
  expect(secureCookie("localhost:3000", "https")).toBe(true);
  expect(secureCookie("corpus.example", "https, http")).toBe(true);
  expect(secureCookie("localhost", null, "https:")).toBe(true);
});

test("plain http to a real host still gets Secure, since remote access needs HTTPS", () => {
  expect(secureCookie("corpus.example", null)).toBe(true);
  expect(secureCookie("corpus.example", "http")).toBe(true);
  expect(secureCookie("192.168.1.20:3000", null)).toBe(true);
});

test("no host at all is treated as remote", () => {
  expect(secureCookie(null, null)).toBe(true);
  expect(secureCookie("", null)).toBe(true);
});

test("a configured HTTPS public URL forces Secure whatever the request says", () => {
  expect(
    secureCookie("localhost:3000", null, "http:", "https://corpus.example"),
  ).toBe(true);
  expect(
    secureCookie("localhost:3000", null, "http:", "http://localhost:3000"),
  ).toBe(false);
  expect(secureCookie("localhost:3000", null, "http:", undefined)).toBe(false);
});
