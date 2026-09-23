import { moonlightManor } from "@corpus/contract";
import { expect, test } from "@playwright/test";
import { join, SMOKE_SECRET } from "./session";

// The workbench order (#527): `corpus workbench` creates the project as
// it starts, so the first person joins into a users table that already
// holds the project's agent actor. That is the order #525 shipped in
// for eight releases while the smoke joined first. This runs against a
// second server on an empty database, so the join here is the first.
test.skip(
  !process.env.CORPUS_SMOKE_URL_WORKBENCH,
  "needs the second server bin/smoke starts (CORPUS_SMOKE_URL_WORKBENCH)",
);

test("the first person to join after the workbench created the project is the maintainer", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    headers: { authorization: `Bearer ${SMOKE_SECRET}` },
    data: {
      slug: moonlightManor.project,
      name: "Moonlight Manor",
      sourceLanguage: moonlightManor.sourceLanguage,
      languages: ["pt-PT", "en"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const { token } = (await created.json()) as { token: string };
  const pushed = await request.post("/api/push", {
    headers: { authorization: `Bearer ${token}` },
    data: moonlightManor,
  });
  expect(pushed.ok()).toBeTruthy();

  await join(page, "ana");
  await page.goto(`/p/${moonlightManor.project}/s/ui.continue`);
  // Only a maintainer sees the verify control (§10).
  await expect(
    page.getByRole("button", { name: "Mark pt-PT as verified" }),
  ).toBeVisible();
});
