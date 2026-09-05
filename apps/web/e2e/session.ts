import type { Page } from "@playwright/test";

// Join the instance through the invite prompt (§10). The first name to
// join becomes the maintainer, which is what the smoke relies on.
export async function join(page: Page, name: string): Promise<void> {
  await page.goto("/invite");
  await page.getByLabel("Display name").fill(name);
  await page
    .getByLabel("Invite secret")
    .fill(process.env.CORPUS_SMOKE_SECRET ?? "smoke-only-not-a-secret");
  await page.getByRole("button", { name: "Enter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/invite"));
}
