import { defineConfig } from "@playwright/test";

// The smoke (§15) runs against a server bin/smoke has already started;
// the URL and the invite secret arrive by environment.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Two servers, two orders (#527): the bare order joins before any
  // project exists, the workbench order joins after the project was
  // provisioned, each on its own empty database.
  projects: [
    {
      name: "bare order",
      testMatch: /smoke\.spec\.ts/,
    },
    {
      name: "workbench order",
      testMatch: /workbench-order\.spec\.ts/,
      use: {
        baseURL:
          process.env.CORPUS_SMOKE_URL_WORKBENCH ??
          process.env.CORPUS_SMOKE_URL ??
          "http://127.0.0.1:3902",
      },
    },
  ],
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
