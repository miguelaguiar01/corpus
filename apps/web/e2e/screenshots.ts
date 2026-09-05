// Corpus translating Corpus, on a phone (§12): stage the fixture into a
// fresh instance, add a little history, and capture the surfaces for the
// README. bin/screenshots starts one fresh server per colour scheme and
// runs this once for each, so light and dark show identical state.
import { chromium, type Page } from "@playwright/test";
import { buildSnapshot, loadConfig } from "@corpus/cli";
import { moonlightManor } from "@corpus/contract";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "./session";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const base = process.env.CORPUS_SMOKE_URL ?? "http://127.0.0.1:3902";
const scheme = process.env.CORPUS_SHOT_SCHEME === "dark" ? "dark" : "light";
// Phone by default (the design target, §9); desktop for the wide layouts.
const desktop = process.env.CORPUS_SHOT_VIEWPORT === "desktop";
const suffix = desktop ? `desktop-${scheme}` : scheme;
const out = process.env.CORPUS_SHOTS_DIR ?? path.resolve("docs/screenshots");
mkdirSync(out, { recursive: true });

async function createProject(
  page: Page,
  slug: string,
  name: string,
  source: string,
  languages: string,
): Promise<string> {
  await page.goto(`${base}/projects/new`);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Source language").fill(source);
  await page.getByLabel("Languages (comma-separated)").fill(languages);
  await page.getByRole("button", { name: "Create project" }).click();
  const token = (
    await page.getByRole("status").locator("code").textContent()
  )?.trim();
  if (!token) throw new Error("no push token shown");
  return token;
}

// The web app compiles as CommonJS, so no top-level await here.
async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: base,
    viewport: desktop
      ? { width: 1280, height: 800 }
      : { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const shot = (name: string) =>
    page.screenshot({ path: path.join(out, `${name}-${suffix}.png`) });

  // The entry surfaces, before there is a session or a project.
  await page.goto(`${base}/invite`, { waitUntil: "networkidle" });
  await shot("invite");
  await join(page, "ana");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await shot("home-empty");
  await page.goto(`${base}/projects/new`, { waitUntil: "networkidle" });
  await shot("new-project");

  // Corpus translating Corpus (§12): the repo's own chrome catalog, built
  // by the real snapshot builder from corpus.config.ts.
  const config = await loadConfig(REPO);
  const chrome = await buildSnapshot(config, REPO);
  const chromeToken = await createProject(
    page,
    config.project,
    "Corpus (chrome)",
    config.sourceLanguage,
    config.languages.join(", "),
  );
  await page.request.post(`${base}/api/push`, {
    headers: { authorization: `Bearer ${chromeToken}` },
    data: chrome,
  });
  const corpus = `${base}/p/${config.project}`;
  const chromeString = (key: string, query: string) =>
    `${corpus}/s/${encodeURIComponent(key)}?${query}`;
  // One translation saved and one source proofread, so the surfaces have
  // some history to show.
  await page.goto(
    chromeString("nav.catalogue", "queue=untranslated&language=pt-PT"),
  );
  await page.getByRole("textbox").fill("Catálogo");
  await page.getByRole("button", { name: "Save translation" }).click();
  await page.waitForURL((url) => !url.href.includes("nav.catalogue"));
  await page.goto(
    chromeString("app.tagline", "queue=unverifiedSource&language=en"),
  );
  await page.getByRole("button", { name: "Mark en as verified" }).click();
  await page.waitForURL((url) => !url.href.includes("app.tagline"));

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await shot("home");
  await page.goto(corpus, { waitUntil: "networkidle" });
  await shot("dashboard");
  await page.goto(`${corpus}/catalogue?q=verified`, {
    waitUntil: "networkidle",
  });
  await shot("catalogue");
  await page.goto(
    chromeString("verify.button", "queue=untranslated&language=pt-PT"),
    {
      waitUntil: "networkidle",
    },
  );
  await page.getByRole("textbox").fill("Marcar {language} como verificado");
  await shot("editor");
  await page.goto(`${corpus}/settings`, { waitUntil: "networkidle" });
  await shot("settings");

  // Structured text: the Moonlight Manor fixture, for selects, entities,
  // and previews the chrome catalog does not have.
  const token = await createProject(
    page,
    moonlightManor.project,
    "Moonlight Manor",
    moonlightManor.sourceLanguage,
    "pt-PT, en",
  );
  await page.request.post(`${base}/api/push`, {
    headers: { authorization: `Bearer ${token}` },
    data: moonlightManor,
  });

  const project = `${base}/p/${moonlightManor.project}`;
  const string = (key: string, query: string) =>
    `${project}/s/${encodeURIComponent(key)}?${query}`;

  // A little history so the surfaces are not empty: one source proofread,
  // one translation saved.
  await page.goto(
    string("skin.heard-nothing", "queue=unverifiedSource&language=pt-PT"),
  );
  await page.getByRole("button", { name: "Mark pt-PT as verified" }).click();
  await page.waitForURL(/ui\.continue/);
  await page.goto(string("ui.continue", "queue=untranslated&language=en"));
  await page.getByRole("textbox").fill("Continue");
  await page.getByRole("button", { name: "Save translation" }).click();
  await page.waitForURL((url) => !url.href.includes("ui.continue"));

  await page.goto(
    string("skin.seen-at-greenhouse-window", "queue=untranslated&language=en"),
    { waitUntil: "networkidle" },
  );
  await page
    .getByRole("textbox")
    .fill(
      "{person} was seen at the {room_de} window at {hour} — and was not alone.",
    );
  await shot("editor-structured");
  await page.goto(`${project}/entities`, { waitUntil: "networkidle" });
  await shot("entities");

  await browser.close();
  console.log(`${scheme}: screenshots written to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
