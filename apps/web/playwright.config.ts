import { defineConfig } from "@playwright/test";

// The smoke (§15) runs against a server bin/smoke has already started;
// the URL and the invite secret arrive by environment.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CORPUS_SMOKE_URL ?? "http://127.0.0.1:3902",
    // A phone viewport on Chromium (the one browser CI installs).
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: "retain-on-failure",
  },
});
