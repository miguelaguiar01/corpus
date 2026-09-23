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

// Forty languages (#489): the picker replaces the language bar from a
// dozen, and nothing in CI rendered it, which is how a server/client
// boundary bug reached review in #477. A second project on this server,
// provisioned with forty languages and the fixture pushed under its slug.
test("a forty-language project's string page offers the picker, filters it and follows an option", async ({
  page,
  request,
}) => {
  const slug = "moonlight-manor-forty";
  const languages = [
    moonlightManor.sourceLanguage,
    ..."af am ar az be bg bn bs ca cs cy da de el eo es et eu fa fi fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ku".split(
      " ",
    ),
  ];
  const created = await request.post("/api/projects", {
    headers: { authorization: `Bearer ${SMOKE_SECRET}` },
    data: {
      slug,
      name: "Moonlight Manor, forty",
      sourceLanguage: moonlightManor.sourceLanguage,
      languages,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { token } = (await created.json()) as { token: string };
  const pushed = await request.post("/api/push", {
    headers: { authorization: `Bearer ${token}` },
    data: { ...moonlightManor, project: slug },
  });
  expect(pushed.ok()).toBeTruthy();

  // A fresh context per test: this one joins as a second person.
  await join(page, "bo");
  await page.goto(`/p/${slug}/s/ui.continue`);
  const picker = page.getByRole("navigation", { name: "Language" });
  await expect(picker).toBeVisible();
  const control = picker.getByRole("button");
  await expect(control).toBeVisible();
  await control.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByPlaceholder("Filter languages…").fill("k");
  await expect(page.getByRole("option")).toHaveCount(6);
  await page.getByRole("option", { name: "ko" }).click();
  await page.waitForURL(/language=ko/);
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(control).toContainText("ko");
});
