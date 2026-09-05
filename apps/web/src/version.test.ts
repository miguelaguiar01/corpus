import { expect, test } from "vitest";
import { appVersion } from "./version";

test("appVersion is the stamp or dev", () => {
  expect(appVersion({ CORPUS_VERSION: "v1.2.0 (abc1234)" })).toBe(
    "v1.2.0 (abc1234)",
  );
  expect(appVersion({})).toBe("dev");
  expect(appVersion({ CORPUS_VERSION: "  " })).toBe("dev");
});
