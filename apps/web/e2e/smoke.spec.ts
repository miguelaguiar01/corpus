import { moonlightManor } from "@corpus/contract";
import { expect, test, type Page } from "@playwright/test";
import { join } from "./session";

// A page that overflows sideways on a phone pans the visual viewport and
// breaks hit-testing of the fixed bottom bar; catch it where it happens.
async function expectNoSidewaysOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(
    overflow,
    "page overflows horizontally on a phone",
  ).toBeLessThanOrEqual(0);
}

// One smoke for the whole loop (§15): invite → new project → push →
// dashboard → queue → translate with chips → verify as maintainer →
// progress updates. Runs on a phone viewport because that is the target.
test("a maintainer takes a string from pushed to verified on a phone", async ({
  page,
  request,
}) => {
  await join(page, "ana");

  await page.goto("/projects/new");
  await page.getByLabel("Slug").fill(moonlightManor.project);
  await page.getByLabel("Name").fill("Moonlight Manor");
  await page.getByLabel("Source language").fill(moonlightManor.sourceLanguage);
  await page.getByLabel("Languages (comma-separated)").fill("pt-PT, en");
  await page.getByRole("button", { name: "Create project" }).click();
  const token = (
    await page.getByRole("status").locator("code").textContent()
  )?.trim();
  expect(token).toBeTruthy();

  const pushed = await request.post("/api/push", {
    headers: { authorization: `Bearer ${token}` },
    data: moonlightManor,
  });
  expect(pushed.ok()).toBeTruthy();

  const dashboard = `/p/${moonlightManor.project}`;
  await page.goto(dashboard);
  await expect(page.getByRole("link", { name: /Untranslated/ })).toContainText(
    "3",
  );
  await expectNoSidewaysOverflow(page);

  await page.getByRole("link", { name: /Untranslated/ }).click();
  await page.waitForURL(/language=en/);
  await page.waitForLoadState("networkidle");
  await expectNoSidewaysOverflow(page);
  const draft = page.getByRole("textbox");
  await draft.fill("was seen at the window ");
  await page.getByRole("button", { name: "{room_de}" }).click();
  await draft.press("End");
  await draft.type(" at ");
  await page.getByRole("button", { name: "{hour}" }).click();
  await draft.press("Home");
  await page.getByRole("button", { name: "{person}" }).click();
  await expect(
    page.getByRole("button", { name: "Save translation" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save translation" }).click();
  await page.waitForURL(/skin\.heard-nothing/);

  await page.goto(dashboard);
  await expect(page.getByRole("link", { name: /Untranslated/ })).toContainText(
    "2",
  );

  await page.getByRole("link", { name: /Unverified source/ }).click();
  await page.waitForURL(/queue=unverifiedSource/);
  await page.waitForLoadState("networkidle");
  await expectNoSidewaysOverflow(page);
  const before = page.url();
  const verify = page.getByRole("button", { name: "Mark pt-PT as verified" });
  await expect(verify).toBeVisible();
  await verify.click();
  await page.waitForURL((url) => url.href !== before);

  await page.goto(dashboard);
  await expect(
    page.getByRole("link", { name: /Unverified source/ }),
  ).toContainText("2");
  await expect(page.getByText("1 verified, 2 translated of 3")).toBeVisible();
});
