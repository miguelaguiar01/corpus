// Corpus translating Corpus, on a phone (§12): stage the fixture into a
// fresh instance, add a little history, and capture the surfaces for the
// README. bin/screenshots starts one fresh server per colour scheme and
// runs this once for each, so light and dark show identical state.
import { chromium, type Page } from "@playwright/test";
import { loadConfig } from "@corpus-tool/cli";
import { frozenChrome } from "./screenshot-fixture";
import { moonlightManor } from "@corpus/contract";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { join, SMOKE_SECRET } from "./session";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const base = process.env.CORPUS_SMOKE_URL ?? "http://127.0.0.1:3902";
const scheme = process.env.CORPUS_SHOT_SCHEME === "dark" ? "dark" : "light";
// Phone by default (the design target, §9); desktop for the wide layouts.
const desktop = process.env.CORPUS_SHOT_VIEWPORT === "desktop";
const suffix = desktop ? `desktop-${scheme}` : scheme;
const out = process.env.CORPUS_SHOTS_DIR ?? path.resolve("docs/screenshots");
mkdirSync(out, { recursive: true });

// Projects come from the provisioning route with the instance secret
// (§10), as the CLI does; the new-project form is captured empty above.
async function createProject(
  page: Page,
  slug: string,
  name: string,
  sourceLanguage: string,
  languages: string[],
): Promise<string> {
  const response = await page.request.post(`${base}/api/projects`, {
    headers: { authorization: `Bearer ${SMOKE_SECRET}` },
    data: { slug, name, sourceLanguage, languages },
  });
  if (!response.ok()) {
    throw new Error(
      `project ${slug}: HTTP ${response.status()} ${await response.text()}`,
    );
  }
  const { token } = (await response.json()) as { token: string };
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
  // From the top of the page, whatever the last action scrolled to. On
  // desktop the frame ends a little under the content instead of at the
  // viewport's bottom, so a short page is not mostly empty canvas.
  const shot = async (name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = path.join(out, `${name}-${suffix}.png`);
    if (!desktop) {
      await page.screenshot({ path: file });
      return;
    }
    const bottom = await page.evaluate(
      () => document.querySelector("main")?.getBoundingClientRect().bottom ?? 0,
    );
    const height = Math.min(800, Math.max(440, Math.ceil(bottom) + 24));
    await page.screenshot({
      path: file,
      clip: { x: 0, y: 0, width: 1280, height },
    });
  };

  // The entry surfaces, before there is a session or a project.
  await page.goto(`${base}/invite`, { waitUntil: "networkidle" });
  await shot("invite");
  await join(page, "ana");
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await shot("home-empty");
  await page.goto(`${base}/projects/new`, { waitUntil: "networkidle" });
  await shot("new-project");

  const save = async (url: string, text: string) => {
    await page.goto(url);
    await page.getByRole("textbox").fill(text);
    await page.getByRole("button", { name: "Save translation" }).click();
    await page.waitForURL((next) => next.href !== url);
  };
  const verify = async (url: string, language: string) => {
    await page.goto(url);
    await page
      .getByRole("button", { name: `Mark ${language} as verified` })
      .click();
    await page.waitForURL((next) => next.href !== url);
  };

  // Corpus translating Corpus (§12): the repo's own chrome catalog and
  // its Portuguese seeds, frozen under docs/screenshots/fixture so the
  // images move only when the interface does (#531); the config still
  // names the project and its languages.
  const config = await loadConfig(REPO);
  const { snapshot: chrome, seeds: seeded } = frozenChrome();
  const chromeToken = await createProject(
    page,
    config.project,
    "Corpus (chrome)",
    config.sourceLanguage,
    config.languages,
  );
  const pushChrome = (snapshot: typeof chrome) =>
    page.request.post(`${base}/api/push`, {
      headers: { authorization: `Bearer ${chromeToken}` },
      data: snapshot,
    });
  await pushChrome({ ...chrome, seedTranslations: { "pt-PT": seeded } });
  const corpus = `${base}/p/${config.project}`;
  const chromeString = (key: string, query: string) =>
    `${corpus}/s/${encodeURIComponent(key)}?${query}`;

  // Enough history for every state to show: sources proofread in
  // English, a few of the seeded translations verified, more saved by
  // hand, and one source changed after its translation so a row is stale.
  for (const key of [
    "app.title",
    "app.tagline",
    "nav.overview",
    "nav.catalogue",
    "nav.entities",
    "nav.settings",
    "nav.signOut",
    "dashboard.queuesHeading",
    "dashboard.progressHeading",
    "queue.untranslated",
    "queue.stale",
    "queue.unverifiedSource",
    "catalogue.heading",
    "entities.heading",
    "settings.heading",
    "verify.button",
  ]) {
    await verify(chromeString(key, "queue=unverifiedSource&language=en"), "en");
  }
  // "Corpus" is the same in both languages, so its Portuguese row seeds
  // as untranslated (§8); a person saying so makes it a translation.
  await save(
    chromeString("app.title", "queue=untranslated&language=pt-PT"),
    "Corpus",
  );
  for (const key of ["app.title", "nav.overview", "nav.catalogue"]) {
    await verify(chromeString(key, "language=pt-PT"), "pt-PT");
  }
  const drafts: Record<string, string> = {
    "dashboard.queuesHeading": "O que fazer",
    "dashboard.progressHeading": "Progresso",
    "queue.untranslated": "Por traduzir",
    "queue.stale": "Desatualizadas",
    "queue.unverifiedSource": "Origem por verificar",
    "state.verified": "Verificada",
  };
  for (const [key, text] of Object.entries(drafts)) {
    await save(chromeString(key, "queue=untranslated&language=pt-PT"), text);
  }
  const changed = structuredClone(chrome);
  const heading = changed.strings.find((s) => s.id === "entities.heading");
  if (heading) heading.source = `${heading.source} & relations`;
  await pushChrome(changed);

  await page.goto(corpus, { waitUntil: "networkidle" });
  await shot("dashboard");
  await page.goto(`${corpus}/catalogue`, { waitUntil: "networkidle" });
  await shot("catalogue");
  await page.goto(
    chromeString("verify.button", "queue=untranslated&language=pt-PT"),
    { waitUntil: "networkidle" },
  );
  await page.getByRole("textbox").fill("Marcar {language} como verificado");
  await shot("editor");
  await page.goto(`${corpus}/settings`, { waitUntil: "networkidle" });
  await shot("settings");
  // A source proposal (§9.3, §11): propose a change on a chrome string,
  // then capture the string page with it pending, and the add form.
  await page.goto(chromeString("queue.stale", "language=pt-PT"));
  await page.getByRole("button", { name: "Propose a change" }).click();
  await page.getByLabel("Proposed source text").fill("Out of date");
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await page.waitForURL(/proposed=1/);
  await page.goto(chromeString("queue.stale", "language=pt-PT"), {
    waitUntil: "networkidle",
  });
  await shot("proposal");
  await page.goto(`${corpus}/strings/new`, { waitUntil: "networkidle" });
  await shot("new-string");

  // Structured text: the Moonlight Manor fixture, for selects, entities,
  // and previews the chrome catalog does not have.
  const token = await createProject(
    page,
    moonlightManor.project,
    "Moonlight Manor",
    moonlightManor.sourceLanguage,
    // A third language, so the editor shows the other-languages block.
    ["pt-PT", "en", "fr"],
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
  await verify(
    string("skin.heard-nothing", "queue=unverifiedSource&language=pt-PT"),
    "pt-PT",
  );
  await save(
    string("ui.continue", "queue=untranslated&language=en"),
    "Continue",
  );

  // An agent's draft through the API (§10), captured from the agent
  // drafts queue with its attribution in the history.
  await page.request.put(
    `${base}/api/strings/skin.heard-nothing/translations/en`,
    {
      headers: { authorization: `Bearer ${token}` },
      data: { text: "I heard nothing all night." },
    },
  );
  await page.goto(
    string("skin.heard-nothing", "queue=agentDrafts&language=en"),
    { waitUntil: "networkidle" },
  );
  await shot("agent-draft");

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
  await page.goto(string("ui.marks-left", "queue=untranslated&language=en"), {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("textbox")
    .fill(
      "{n, plural, =0 {No marks left to find.} one {# mark left.} other {# marks left.}}",
    );
  await shot("editor-plural");
  await page.goto(`${project}/entities`, { waitUntil: "networkidle" });
  await shot("entities");
  // Both projects staged: the home page has two cards with real progress.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await shot("home");

  await browser.close();
  console.log(`${scheme}: screenshots written to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
