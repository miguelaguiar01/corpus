import { expect, test } from "vitest";
import { secretGate } from "./secret";

const SECRET = "s3cret";

function req(auth?: string, client = "10.0.0.1") {
  return new Request("http://corpus.test/api/projects", {
    method: "POST",
    headers: {
      "x-forwarded-for": client,
      ...(auth === undefined ? {} : { authorization: auth }),
    },
  });
}

test("the instance secret as a bearer token passes", () => {
  const gate = secretGate();
  expect(gate(req(`Bearer ${SECRET}`), SECRET).ok).toBe(true);
});

test("a missing or wrong secret is 401", async () => {
  const gate = secretGate();
  const missing = gate(req(), SECRET);
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.response.status).toBe(401);
  const wrong = gate(req("Bearer nope"), SECRET);
  expect(wrong.ok).toBe(false);
  if (!wrong.ok) {
    expect(wrong.response.status).toBe(401);
    const body = (await wrong.response.json()) as { message: string };
    expect(body.message).not.toContain(SECRET);
  }
});

test("failures are rate-limited per client, successes are not counted", () => {
  const gate = secretGate({ max: 2, windowMs: 60_000, globalMax: 100 });
  gate(req("Bearer nope"), SECRET);
  gate(req("Bearer nope"), SECRET);
  const limited = gate(req(`Bearer ${SECRET}`), SECRET);
  expect(limited.ok).toBe(false);
  if (!limited.ok) {
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toMatch(/^\d+$/);
  }
  expect(gate(req(`Bearer ${SECRET}`, "10.0.0.2"), SECRET).ok).toBe(true);
});

test("the global cap bounds spoofed clients", () => {
  const gate = secretGate({ max: 100, windowMs: 60_000, globalMax: 2 });
  gate(req("Bearer nope", "1.1.1.1"), SECRET);
  gate(req("Bearer nope", "2.2.2.2"), SECRET);
  const limited = gate(req(`Bearer ${SECRET}`, "3.3.3.3"), SECRET);
  expect(limited.ok).toBe(false);
  if (!limited.ok) expect(limited.response.status).toBe(429);
});

test("an unconfigured secret is a server error, not an open door", () => {
  const gate = secretGate();
  expect(() => gate(req(`Bearer ${SECRET}`), undefined)).toThrow(
    /CORPUS_INVITE_SECRET/,
  );
});
