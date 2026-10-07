import { expect, test } from "vitest";
import nextConfig from "../../next.config";
import { MAX_BODY_BYTES } from "./limits";

test("a push body is capped at 128 MiB, and the proxy clones bodies up to the same number (#593, #717)", () => {
  expect(MAX_BODY_BYTES).toBe(128 * 1024 * 1024);
  expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(MAX_BODY_BYTES);
});
