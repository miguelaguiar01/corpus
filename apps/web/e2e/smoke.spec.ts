import { moonlightManor } from "@corpus/contract";
import { expect, test, type Page } from "@playwright/test";
import { join, signIn, signOut } from "./session";

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

  // The desktop layouts must not overflow either.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNoSidewaysOverflow(page);
  await page.goto(`/p/${moonlightManor.project}/catalogue`);
  await expectNoSidewaysOverflow(page);
  await page.getByRole("link", { name: /seen-at-greenhouse-window/ }).click();
  await expectNoSidewaysOverflow(page);

  // The language chips switch the target on the string itself (§9.3).
  await page.getByRole("link", { name: /^en( stale)?$/ }).click();
  await page.waitForURL(/language=en/);
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.getByRole("link", { name: /^pt-PT( stale)?$/ }).click();
  await page.waitForURL((url) => !url.search.includes("language="));
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^pt-PT( stale)?$/ }),
  ).toHaveAttribute("aria-current", "page");

  // A third language: while editing one target, the other is readable
  // under the source (§9.3).
  await page.goto(`/p/${moonlightManor.project}/settings`);
  await page.getByLabel("Target languages").fill("en, fr");
  await page.getByRole("button", { name: "Save languages" }).click();
  await page.waitForURL(/saved=languages/);
  await page.goto(
    `/p/${moonlightManor.project}/s/skin.seen-at-greenhouse-window?language=en`,
  );
  await expect(
    page.getByRole("heading", { name: "Other languages" }),
  ).toBeVisible();
  await expect(page.getByText("No translation yet")).toBeVisible();
  // And from the third language, the English translation saved above
  // reads through.
  await page.goto(
    `/p/${moonlightManor.project}/s/skin.seen-at-greenhouse-window?language=fr`,
  );
  await expect(
    page.getByRole("heading", { name: "Other languages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: /was seen at the window/ }),
  ).toBeVisible();

  // The fixture's English values: the draft previews as the English
  // sentence, and a chip says what its slot resolves to (§7).
  await page.goto(
    `/p/${moonlightManor.project}/s/skin.seen-at-greenhouse-window?language=en`,
  );
  await page
    .getByRole("textbox")
    .fill("{person} was seen at the {room_de} window at {hour}.");
  await expect(
    page.getByRole("region", { name: "Preview with en values" }),
  ).toContainText("Countess Rosa was seen at the greenhouse window at 9 pm.");
  await expect(page.getByRole("button", { name: "{room_de}" })).toHaveAttribute(
    "title",
    "Room with 'de' contraction baked in\ngreenhouse",
  );

  // Signing out ends the session on the server; signing back in with the
  // password lands on the same instance with the same account.
  await signOut(page);
  await page.goto(dashboard);
  await page.waitForURL(/\/invite/);
  await signIn(page, "ana");
  await page.goto(dashboard);
  await expect(page.getByText("1 verified, 2 translated of 3")).toBeVisible();
});
