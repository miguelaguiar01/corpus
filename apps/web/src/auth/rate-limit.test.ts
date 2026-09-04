import { expect, test } from "vitest";
import { RateLimiter } from "./rate-limit";

test("allows attempts up to the limit", () => {
  const limiter = new RateLimiter({ max: 3, windowMs: 60_000 });
  const t = 1_000_000;
  expect(limiter.allow("1.2.3.4", t)).toBe(true);
  expect(limiter.allow("1.2.3.4", t + 1)).toBe(true);
  expect(limiter.allow("1.2.3.4", t + 2)).toBe(true);
});

test("blocks the attempt past the limit", () => {
  const limiter = new RateLimiter({ max: 3, windowMs: 60_000 });
  const t = 1_000_000;
  limiter.allow("1.2.3.4", t);
  limiter.allow("1.2.3.4", t);
  limiter.allow("1.2.3.4", t);
  expect(limiter.allow("1.2.3.4", t + 3)).toBe(false);
});

test("keys are independent", () => {
  const limiter = new RateLimiter({ max: 1, windowMs: 60_000 });
  const t = 1_000_000;
  expect(limiter.allow("1.2.3.4", t)).toBe(true);
  expect(limiter.allow("5.6.7.8", t)).toBe(true);
  expect(limiter.allow("1.2.3.4", t + 1)).toBe(false);
});

test("the window resets after windowMs", () => {
  const limiter = new RateLimiter({ max: 1, windowMs: 60_000 });
  const t = 1_000_000;
  expect(limiter.allow("1.2.3.4", t)).toBe(true);
  expect(limiter.allow("1.2.3.4", t + 59_999)).toBe(false);
  expect(limiter.allow("1.2.3.4", t + 60_001)).toBe(true);
});

test("expired entries are evicted instead of accumulating", () => {
  const limiter = new RateLimiter({ max: 1, windowMs: 60_000, maxKeys: 100 });
  const t = 1_000_000;
  limiter.allow("a", t);
  limiter.allow("b", t);
  limiter.allow("c", t);
  expect(limiter.size).toBe(3);
  limiter.allow("d", t + 60_001);
  expect(limiter.size).toBe(1);
});

test("fails closed when the key table is full of live entries", () => {
  const limiter = new RateLimiter({ max: 5, windowMs: 60_000, maxKeys: 2 });
  const t = 1_000_000;
  expect(limiter.allow("a", t)).toBe(true);
  expect(limiter.allow("b", t + 1)).toBe(true);
  expect(limiter.allow("c", t + 2)).toBe(false);
  expect(limiter.allow("a", t + 3)).toBe(true);
});
