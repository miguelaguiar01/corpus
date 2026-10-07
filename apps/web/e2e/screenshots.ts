// Corpus translating Corpus, on a phone (§12): stage the fixture into a
// fresh instance, add a little history, and capture the surfaces for the
// README. bin/screenshots starts one fresh server per colour scheme and
// runs this once for each, so light and dark show identical state.
import { chromium, type Page } from "@playwright/test";
import { loadConfig } from "@corpus-tool/cli";
import { frozenChrome } from "./screenshot-fixture";
import { moonlightManor } from "@corpus/contract";
import Database from "better-sqlite3";
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

// The stamps the pages print, pinned so two runs give the same images
// (#580): each table's, in the order they were made, the first at a
// fixed minute and each next one a minute on. The pages are rendered per
// request, so the next load shows them; the app keeps its own clock.
const PINNED = Date.UTC(2026, 0, 15, 9, 0);
const STAMPS: [table: string, columns: string[]][] = [
  ["pushes", ["at"]],
  ["source_changes", ["created_at", "resolved_at"]],
  ["edits", ["at"]],
];

function pinClock(): void {
  const file = process.env.CORPUS_SHOT_DB;
  if (!file) throw new Error("CORPUS_SHOT_DB names no database to pin");
  const db = new Database(file);
  try {
    for (const [table, columns] of STAMPS) {
      const rows = columns.flatMap((column) =>
        (
          db
            .prepare(
              `select rowid as id, ${column} as at from ${table} where ${column} is not null`,
            )
            .all() as { id: number; at: number }[]
        ).map((row) => ({ ...row, column })),
      );
      rows.sort(
        (a, b) =>
          a.at - b.at || a.id - b.id || a.column.localeCompare(b.column),
      );
      rows.forEach((row, rank) =>
        db
          .prepare(`update ${table} set ${row.column} = ? where rowid = ?`)
          .run(PINNED + rank * 60_000, row.id),
      );
    }
  } finally {
    db.close();
  }
}

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
  // A page that is shot is loaded after the clock is pinned.
  const visit = async (url: string) => {
    pinClock();
    await page.goto(url, { waitUntil: "networkidle" });
  };
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
  await visit(`${base}/invite`);
  await shot("invite");
  await join(page, "ana");
  await visit(`${base}/`);
  await shot("home-empty");
  await visit(`${base}/projects/new`);
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
  // A suggestion on the string the editor shot opens (#774); every push
  // replaces suggestions, so this one carries it.
  await pushChrome({
    ...changed,
    seedSuggestions: { "pt-PT": { "verify.button": "Marcar como verificado" } },
  });

  await visit(corpus);
  await shot("dashboard");
  await visit(`${corpus}/catalogue`);
  await shot("catalogue");
  await visit(
    chromeString("verify.button", "queue=untranslated&language=pt-PT"),
  );
  await page.getByRole("textbox").fill("Marcar {language} como verificado");
  await shot("editor");
  await visit(`${corpus}/settings`);
  await shot("settings");
  // A source proposal (§9.3, §11): propose a change on a chrome string,
  // then capture the string page with it pending, and the add form.
  await page.goto(chromeString("queue.stale", "language=pt-PT"));
  await page.getByRole("button", { name: "Propose a change" }).click();
  await page.getByLabel("Proposed source text").fill("Out of date");
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await page.waitForURL(/proposed=1/);
  await visit(chromeString("queue.stale", "language=pt-PT"));
  await shot("proposal");
  await visit(`${corpus}/strings/new`);
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
  await visit(string("skin.heard-nothing", "queue=agentDrafts&language=en"));
  await shot("agent-draft");

  await visit(
    string("skin.seen-at-greenhouse-window", "queue=untranslated&language=en"),
  );
  await page
    .getByRole("textbox")
    .fill(
      "{person} was seen at the {room_de} window at {hour} — and was not alone.",
    );
  await shot("editor-structured");
  await visit(string("ui.marks-left", "queue=untranslated&language=en"));
  await page
    .getByRole("textbox")
    .fill(
      "{n, plural, =0 {No marks left to find.} one {# mark left.} other {# marks left.}}",
    );
  await shot("editor-plural");
  await visit(`${project}/entities`);
  await shot("entities");
  // Both projects staged: the home page has two cards with real progress.
  await visit(`${base}/`);
  await shot("home");

  await browser.close();
  console.log(`${scheme}: screenshots written to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
