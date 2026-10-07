import { moonlightManor, type Snapshot } from "@corpus/contract";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import { projects, strings, stringTranslations, users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { applySnapshot } from "@/ingest/apply";
import { applyTransition } from "@/translations/service";
import { ensureAgentActor } from "@/agents/actor";
import {
  QUEUE_KINDS,
  queueCounts,
  queueItems,
  queueNeighbours,
  queueStep,
  queueSummaries,
  type Queue,
  type QueueItem,
} from "./queues";

// What the string page did before #639, over the whole queue: the oracle
// queueStep and queueNeighbours are held to.
function neighbours(
  queue: Queue,
  current: Pick<QueueItem, "stringId" | "language">,
) {
  const index = queue.items.findIndex(
    (item) =>
      item.stringId === current.stringId && item.language === current.language,
  );
  if (index < 0) return { index: null, previous: null, next: null };
  return {
    index,
    previous: queue.items[index - 1] ?? null,
    next: queue.items[index + 1] ?? null,
  };
}

const FIXTURE = moonlightManor as Snapshot;

function pushed() {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    })
    .returning()
    .all();
  const [maintainer] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  if (!p || !maintainer) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, maintainer };
}

function dbId(db: Db, stringId: string): number {
  const row = db
    .select()
    .from(strings)
    .where(eq(strings.stringId, stringId))
    .get();
  if (!row) throw new Error(`no string ${stringId}`);
  return row.id;
}

function item(db: Db, key: string, language: string) {
  const row = db.select().from(strings).where(eq(strings.stringId, key)).get()!;
  const translation = db
    .select()
    .from(stringTranslations)
    .where(
      and(
        eq(stringTranslations.stringId, row.id),
        eq(stringTranslations.language, language),
      ),
    )
    .get()!;
  return {
    stringId: row.id,
    key,
    language,
    type: row.type,
    source: row.source,
    text: translation.text,
  };
}

// Fixture order by insertion (= internal id): greenhouse, heard-nothing, ui.continue.
const IDS = FIXTURE.strings.map((s) => s.id);

test("after a first push: every target row is untranslated, every source row unverified, nothing stale", () => {
  const { db, p } = pushed();
  expect(queueCounts(db, p.id)).toEqual({
    untranslated: 4,
    stale: 0,
    unverifiedSource: 4,
    agentDrafts: 0,
    invalid: 0,
  });
});

test("items are ordered by string id then language, and first is the head of the list", () => {
  const { db, p } = pushed();
  const queue = queueItems(db, p.id, "untranslated");
  expect(queue.items).toEqual(IDS.map((id) => item(db, id, "en")));
  expect(queue.first).toEqual(queue.items[0]);
  expect(queue.count).toBe(4);
});

test("unverified source lists source-language rows still in translated", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[0]!),
    language: "pt-PT",
    action: { type: "verify" },
    actor: maintainer,
  });
  const queue = queueItems(db, p.id, "unverifiedSource");
  expect(queue.items).toEqual(IDS.slice(1).map((id) => item(db, id, "pt-PT")));
  expect(queueCounts(db, p.id).unverifiedSource).toBe(3);
});

test("a saved target leaves the untranslated queue", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[1]!),
    language: "en",
    action: { type: "save", text: "Heard nothing." },
    actor: maintainer,
  });
  expect(queueItems(db, p.id, "untranslated").items).toEqual(
    [IDS[0], IDS[2], IDS[3]].map((id) => item(db, id!, "en")),
  );
});

test("stale lists rows marked by a push that changed the source", () => {
  const { db, p, maintainer } = pushed();
  applyTransition(db, {
    stringId: dbId(db, IDS[2]!),
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: maintainer,
  });
  const changed: Snapshot = {
    ...FIXTURE,
    strings: FIXTURE.strings.map((s, i) =>
      i === 2 ? { ...s, source: s.source + "!" } : s,
    ),
  };
  applySnapshot(db, p.id, changed);
  const queue = queueItems(db, p.id, "stale");
  expect(queue.items).toEqual([item(db, IDS[2]!, "en")]);
  expect(queueCounts(db, p.id).stale).toBe(1);
});

test("archived strings are excluded from every queue", () => {
  const { db, p } = pushed();
  db.update(strings)
    .set({ archived: true })
    .where(eq(strings.id, dbId(db, IDS[0]!)))
    .run();
  expect(queueCounts(db, p.id)).toEqual({
    untranslated: 3,
    stale: 0,
    unverifiedSource: 3,
    agentDrafts: 0,
    invalid: 0,
  });
  expect(
    queueItems(db, p.id, "untranslated").items.map((i) => i.stringId),
  ).not.toContain(dbId(db, IDS[0]!));
});

test("an empty queue has count 0 and no first item", () => {
  const { db, p } = pushed();
  expect(queueItems(db, p.id, "stale")).toEqual({
    kind: "stale",
    count: 0,
    first: null,
    items: [],
  });
});

test("queues are scoped to the project", () => {
  const { db } = pushed();
  const [other] = db
    .insert(projects)
    .values({ slug: "o", name: "O", sourceLanguage: "en", languages: ["en"] })
    .returning()
    .all();
  expect(queueCounts(db, other!.id)).toEqual({
    untranslated: 0,
    stale: 0,
    unverifiedSource: 0,
    agentDrafts: 0,
    invalid: 0,
  });
});

test("the summaries give every queue's count and first item, as its items do (#603)", () => {
  const { db, p } = pushed();
  const all = queueSummaries(db, p.id);
  expect(Object.keys(all).sort()).toEqual([
    "agentDrafts",
    "invalid",
    "stale",
    "untranslated",
    "unverifiedSource",
  ]);
  const untranslated = queueItems(db, p.id, "untranslated");
  expect(all.untranslated).toEqual({
    count: untranslated.count,
    first: untranslated.first,
  });
  expect(all.stale).toEqual({ count: 0, first: null });
  expect(all.unverifiedSource.first).toEqual(item(db, IDS[0]!, "pt-PT"));
  expect(queueCounts(db, p.id).untranslated).toBe(untranslated.count);
});

test("a queue narrowed by language and type holds exactly the matching items (#603)", () => {
  const { db, p } = pushed();
  const all = queueItems(db, p.id, "unverifiedSource").items;
  const narrowed = queueItems(db, p.id, "unverifiedSource", {
    language: "pt-PT",
    type: "chrome",
  }).items;
  expect(narrowed).toEqual(
    all.filter((i) => i.language === "pt-PT" && i.type === "chrome"),
  );
  expect(narrowed.length).toBeGreaterThan(0);
  expect(
    queueItems(db, p.id, "unverifiedSource", { language: "en" }).items,
  ).toEqual([]);
});

test("agent drafts lists the translated rows an agent last edited, and leaves when a person takes over", () => {
  const { db, p, maintainer } = pushed();
  const agent = ensureAgentActor(db, p);
  const save = (
    actor: { id: number; maintainer: boolean },
    key: string,
    text: string,
  ) =>
    applyTransition(db, {
      stringId: dbId(db, key),
      language: "en",
      action: { type: "save", text },
      actor,
    });
  expect(queueCounts(db, p.id).agentDrafts).toBe(0);
  save(agent, "ui.continue", "Continue");
  save(maintainer, "skin.heard-nothing", "Nothing.");
  expect(queueItems(db, p.id, "agentDrafts").items).toEqual([
    item(db, "ui.continue", "en"),
  ]);
  expect(queueSummaries(db, p.id).agentDrafts).toEqual({
    count: 1,
    first: item(db, "ui.continue", "en"),
  });

  applyTransition(db, {
    stringId: dbId(db, "ui.continue"),
    language: "en",
    action: { type: "verify" },
    actor: maintainer,
  });
  expect(queueCounts(db, p.id).agentDrafts).toBe(0);
});

test("agent drafts are counted in SQL, however many strings agents have edited on the instance (#603)", () => {
  const { db, p } = pushed();
  const other = db
    .insert(projects)
    .values({
      slug: "other",
      name: "Other",
      sourceLanguage: "en",
      languages: ["en", "de"],
    })
    .returning()
    .get();
  const agent = ensureAgentActor(db, other);
  const client = (
    db as unknown as { $client: import("better-sqlite3").Database }
  ).$client;
  // More distinct edited strings than SQLite takes variables in one
  // statement.
  client.exec(`
    with recursive n(i) as (select 1 union all select i + 1 from n where i < 40000)
    insert into strings (project_id, string_id, type, source, archived, created_at)
      select ${other.id}, 'k' || i, 'ui', 'Text', 0, 0 from n;
    insert into edits (string_id, language, user_id, at, old_text, new_text, old_state, new_state)
      select id, 'de', ${agent.id}, 0, null, 'Text', 'untranslated', 'translated'
      from strings where project_id = ${other.id};
  `);
  expect(queueCounts(db, p.id).agentDrafts).toBe(0);
  expect(queueSummaries(db, p.id).agentDrafts).toEqual({
    count: 0,
    first: null,
  });
});

test("the Invalid queue lists a seeded translation that fails validation, and a save takes it out (#646)", () => {
  const { db, p, maintainer } = pushed();
  applySnapshot(db, p.id, {
    ...FIXTURE,
    seedTranslations: { en: { "skin.seen-at-greenhouse-window": "Seen." } },
  });
  expect(queueItems(db, p.id, "invalid").items).toEqual([
    item(db, "skin.seen-at-greenhouse-window", "en"),
  ]);
  expect(queueSummaries(db, p.id).invalid.count).toBe(1);
  applyTransition(db, {
    stringId: dbId(db, "skin.seen-at-greenhouse-window"),
    language: "en",
    action: { type: "save", text: FIXTURE.strings[0]!.source },
    actor: maintainer,
  });
  expect(queueCounts(db, p.id).invalid).toBe(0);
});

test("the Invalid queue's count and items start from its partial index, never the project's strings (#858)", () => {
  const { db, p } = pushed();
  db.update(stringTranslations)
    .set({ invalid: true })
    .where(
      and(
        eq(stringTranslations.stringId, dbId(db, "ui.continue")),
        eq(stringTranslations.language, "en"),
      ),
    )
    .run();
  // Every statement the queue runs, with its parameters, to ask SQLite
  // how it would run each.
  type Client = {
    prepare: (source: string) => {
      all: (...params: unknown[]) => unknown[];
      get: (...params: unknown[]) => unknown;
    };
  };
  const client = (db as unknown as { $client: Client }).$client;
  const ran: { source: string; params: unknown[] }[] = [];
  const prepare = client.prepare.bind(client);
  client.prepare = (source) => {
    const statement = prepare(source);
    for (const method of ["all", "get"] as const) {
      const run = statement[method].bind(statement);
      statement[method] = ((...params: unknown[]) => {
        ran.push({ source, params });
        return run(...params);
      }) as never;
    }
    return statement;
  };
  try {
    expect(queueItems(db, p.id, "invalid").items.map((i) => i.key)).toEqual([
      "ui.continue",
    ]);
    expect(queueCounts(db, p.id).invalid).toBe(1);
    expect(queueSummaries(db, p.id).invalid.first?.key).toBe("ui.continue");
    // The string page's step through it too (#639 review).
    const current = { stringId: dbId(db, "ui.continue"), language: "en" };
    expect(queueStep(db, p.id, "invalid", current).index).toBe(0);
    expect(queueNeighbours(db, p.id, "invalid", current).next).toBeNull();
  } finally {
    client.prepare = prepare;
  }
  const invalid = ran.filter((r) => /"invalid" = /.test(r.source));
  expect(invalid.length).toBeGreaterThan(0);
  for (const { source, params } of invalid) {
    const plan = (
      client.prepare(`explain query plan ${source}`).all(...params) as {
        detail: string;
      }[]
    ).map((row) => row.detail);
    expect(plan[0]).toMatch(/translations_invalid/);
  }
});

test("queueStep and queueNeighbours give what neighbours over the whole queue gives, for every row of every queue (#639)", () => {
  const db = memoryDb();
  const [p] = db
    .insert(projects)
    .values({
      slug: "mm",
      name: "MM",
      sourceLanguage: "pt-PT",
      // fr is a variant of the source: its untranslated rows are no work.
      languages: ["pt-PT", "en", "fr", "de"],
      sourceVariants: ["fr"],
    })
    .returning()
    .all();
  const [ana] = db
    .insert(users)
    .values({ name: "ana", maintainer: true })
    .returning()
    .all();
  applySnapshot(db, p!.id, {
    ...FIXTURE,
    // An invalid seed, so that queue has a row.
    seedTranslations: { de: { "skin.seen-at-greenhouse-window": "Gesehen." } },
  });
  // Saves and a verify move rows between queues.
  applyTransition(db, {
    stringId: dbId(db, "ui.continue"),
    language: "en",
    action: { type: "save", text: "Continue" },
    actor: ana!,
  });
  applyTransition(db, {
    stringId: dbId(db, "skin.heard-nothing"),
    language: "pt-PT",
    action: { type: "verify" },
    actor: ana!,
  });
  const rows = db
    .select({
      stringId: stringTranslations.stringId,
      language: stringTranslations.language,
    })
    .from(stringTranslations)
    .all();
  let compared = 0;
  for (const kind of QUEUE_KINDS) {
    const queue = queueItems(db, p!.id, kind);
    for (const current of rows) {
      const around = neighbours(queue, current);
      expect(
        queueStep(db, p!.id, kind, current),
        `${kind} ${JSON.stringify(current)}`,
      ).toEqual({
        kind,
        ...around,
        // A row outside the queue shows no position, so none is counted.
        count: around.index === null ? null : queue.count,
        languages: queue.items
          .filter((i) => i.stringId === current.stringId)
          .map((i) => i.language),
      });
      expect(queueNeighbours(db, p!.id, kind, current)).toEqual({
        previous: around.previous,
        next: around.next,
      });
      compared += 1;
    }
  }
  // Every queue, the first row, the last, a middle one and rows outside.
  expect(compared).toBe(QUEUE_KINDS.length * rows.length);
  expect(queueItems(db, p!.id, "invalid").count).toBe(1);
  expect(
    queueItems(db, p!.id, "untranslated").items.some(
      (i) => i.language === "fr",
    ),
  ).toBe(false);
});

test("a step's previous and next walk the translations' own index, in order, with no sort, on a database without statistics (#639 review)", () => {
  const { db, p } = pushed();
  type Client = {
    prepare: (source: string) => {
      all: (...params: unknown[]) => unknown[];
      get: (...params: unknown[]) => unknown;
    };
  };
  const client = (db as unknown as { $client: Client }).$client;
  const ran: { source: string; params: unknown[] }[] = [];
  const prepare = client.prepare.bind(client);
  client.prepare = (source) => {
    const statement = prepare(source);
    for (const method of ["all", "get"] as const) {
      const run = statement[method].bind(statement);
      statement[method] = ((...params: unknown[]) => {
        ran.push({ source, params });
        return run(...params);
      }) as never;
    }
    return statement;
  };
  try {
    for (const kind of ["untranslated", "stale", "unverifiedSource"] as const)
      queueNeighbours(db, p.id, kind, {
        stringId: dbId(db, "skin.heard-nothing"),
        language: kind === "unverifiedSource" ? "pt-PT" : "en",
      });
  } finally {
    client.prepare = prepare;
  }
  const walks = ran.filter((r) => / limit /.test(r.source));
  expect(walks.length).toBeGreaterThan(0);
  for (const { source, params } of walks) {
    const plan = (
      client.prepare(`explain query plan ${source}`).all(...params) as {
        detail: string;
      }[]
    ).map((row) => row.detail);
    expect(plan[0], source).toMatch(
      /string_translations USING INDEX translations_string_language/,
    );
    expect(plan.join("\n"), source).not.toMatch(/TEMP B-TREE/);
  }
});
