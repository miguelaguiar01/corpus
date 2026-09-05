import type { Page } from "@playwright/test";

export const E2E_PASSWORD = "smoke password, long enough";

// Joins the instance through the invite form. The first person to join
// becomes the maintainer, which is what the smoke relies on.
export async function join(page: Page, name: string): Promise<void> {
  await page.goto("/invite");
  await page
    .getByLabel("Invite secret")
    .fill(process.env.CORPUS_SMOKE_SECRET ?? "smoke-only-not-a-secret");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Choose a password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/invite"));
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/invite");
}

export async function signIn(page: Page, name: string): Promise<void> {
  await page.goto("/invite");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/invite"));
}
