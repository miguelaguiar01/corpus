import { moonlightManor, type Snapshot } from "@corpus/contract";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import type { Db } from "@/db";
import { memoryDb } from "@/db/test-helpers";
import { projects, sourceChanges, strings, users } from "@/db/schema";
import { applySnapshot } from "@/ingest/apply";
import {
  pendingCount,
  pendingForString,
  pendingKeys,
  proposeAdd,
  proposeDelete,
  proposeEdit,
  sourceChangesFor,
  withdrawProposal,
} from "./service";

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
  const [ana, rui] = db
    .insert(users)
    .values([
      { name: "ana", maintainer: true },
      { name: "rui", maintainer: false },
    ])
    .returning()
    .all();
  if (!p || !ana || !rui) throw new Error("seed failed");
  applySnapshot(db, p.id, FIXTURE);
  return { db, p, ana, rui };
}

function row(db: Db, key: string) {
  return db.select().from(strings).where(eq(strings.stringId, key)).get()!;
}

test("push stores each entry's file and the project's writable sources", () => {
  const { db, p } = pushed();
  expect(row(db, "ui.continue").file).toBe("src/ui/pt-PT.json");
  const project = db.select().from(projects).where(eq(projects.id, p.id)).get();
  expect(project?.sources?.map((s) => s.path)).toEqual([
    "src/skins/{lang}.json",
    "src/ui/{lang}.json",
  ]);
});

test("an edit needs a writable string, valid ICU and a change; the newest supersedes", () => {
  const { db, ana, rui } = pushed();
  const ui = row(db, "ui.continue");
  expect(
    proposeEdit(db, { stringRowId: ui.id, text: "Continuar", actor: ana }),
  ).toEqual({
    ok: false,
    reason: "unchanged",
  });
  expect(
    proposeEdit(db, { stringRowId: ui.id, text: "Seguir {", actor: ana }),
  ).toEqual({
    ok: false,
    reason: "invalid-icu",
  });
  const first = proposeEdit(db, {
    stringRowId: ui.id,
    text: "Seguir",
    actor: ana,
  });
  expect(first.ok).toBe(true);
  const second = proposeEdit(db, {
    stringRowId: ui.id,
    text: "Avançar",
    actor: rui,
  });
  expect(second.ok).toBe(true);
  const pending = pendingForString(db, ui.id);
  expect(pending?.text).toBe("Avançar");
  expect(pending?.author).toBe("rui");
  expect(pendingCount(db, ui.projectId)).toBe(1);
  expect(proposeEdit(db, { stringRowId: 9999, text: "x", actor: ana })).toEqual(
    {
      ok: false,
      reason: "not-found",
    },
  );
});

test("a string without a file (exec) refuses proposals", () => {
  const { db, ana } = pushed();
  const ui = row(db, "ui.continue");
  db.update(strings).set({ file: null }).where(eq(strings.id, ui.id)).run();
  expect(
    proposeEdit(db, { stringRowId: ui.id, text: "Seguir", actor: ana }),
  ).toEqual({
    ok: false,
    reason: "not-writable",
  });
  expect(proposeDelete(db, { stringRowId: ui.id, actor: ana })).toEqual({
    ok: false,
    reason: "not-writable",
  });
});

test("an add needs a declared source, a valid new key and valid ICU; the file is the source-language path", () => {
  const { db, p, ana } = pushed();
  const base = {
    projectId: p.id,
    sourcePath: "src/ui/{lang}.json",
    text: "Voltar",
    actor: ana,
  };
  expect(proposeAdd(db, { ...base, key: "ui.back" }).ok).toBe(true);
  expect(sourceChangesFor(db, p.id)).toEqual([
    {
      kind: "add",
      id: "ui.back",
      type: "chrome",
      file: "src/ui/pt-PT.json",
      text: "Voltar",
    },
  ]);
  expect(proposeAdd(db, { ...base, key: "ui.continue" })).toEqual({
    ok: false,
    reason: "exists",
  });
  expect(proposeAdd(db, { ...base, key: "bad key" })).toEqual({
    ok: false,
    reason: "invalid-key",
  });
  expect(
    proposeAdd(db, { ...base, key: "ui.x", sourcePath: "nope/{lang}.json" }),
  ).toEqual({
    ok: false,
    reason: "unknown-source",
  });
  expect(proposeAdd(db, { ...base, key: "ui.x", text: "" })).toEqual({
    ok: false,
    reason: "invalid-icu",
  });
  expect(pendingKeys(db, p.id)).toEqual(new Set(["ui.back"]));
});

test("withdraw is the author's or a maintainer's, once", () => {
  const { db, ana, rui } = pushed();
  const ui = row(db, "ui.continue");
  const mine = proposeDelete(db, { stringRowId: ui.id, actor: rui });
  if (!mine.ok) throw new Error(mine.reason);
  const [other] = db
    .insert(users)
    .values({ name: "zé", maintainer: false })
    .returning()
    .all();
  expect(
    withdrawProposal(db, { proposalId: mine.proposal.id, actor: other! }),
  ).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(
    withdrawProposal(db, { proposalId: mine.proposal.id, actor: rui }),
  ).toEqual({ ok: true });
  expect(
    withdrawProposal(db, { proposalId: mine.proposal.id, actor: ana }),
  ).toEqual({
    ok: false,
    reason: "not-pending",
  });
  expect(pendingForString(db, ui.id)).toBeUndefined();
  const again = proposeDelete(db, { stringRowId: ui.id, actor: rui });
  if (!again.ok) throw new Error(again.reason);
  expect(
    withdrawProposal(db, { proposalId: again.proposal.id, actor: ana }),
  ).toEqual({ ok: true });
});

test("a push reconciles: applied when the repository agrees, superseded when it moved on or archived, pending otherwise", () => {
  const { db, p, ana } = pushed();
  const ui = row(db, "ui.continue");
  const heard = row(db, "skin.heard-nothing");
  const seen = row(db, "skin.seen-at-greenhouse-window");
  proposeEdit(db, { stringRowId: ui.id, text: "Seguir", actor: ana });
  proposeDelete(db, { stringRowId: heard.id, actor: ana });
  proposeEdit(db, { stringRowId: seen.id, text: "Outra frase", actor: ana });
  proposeAdd(db, {
    projectId: p.id,
    key: "ui.back",
    sourcePath: "src/ui/{lang}.json",
    text: "Voltar",
    actor: ana,
  });
  proposeAdd(db, {
    projectId: p.id,
    key: "ui.skip",
    sourcePath: "src/ui/{lang}.json",
    text: "Saltar",
    actor: ana,
  });

  // The repository merged the edit and the delete, added ui.back as
  // proposed and ui.skip with other text, and changed the sighting's
  // source to something else.
  const next = structuredClone(FIXTURE);
  next.strings = next.strings.filter((s) => s.id !== "skin.heard-nothing");
  next.strings.find((s) => s.id === "ui.continue")!.source = "Seguir";
  next.strings.find((s) => s.id === "skin.seen-at-greenhouse-window")!.source =
    "Uma frase diferente";
  next.strings.push(
    {
      id: "ui.back",
      type: "chrome",
      source: "Voltar",
      file: "src/ui/pt-PT.json",
    },
    {
      id: "ui.skip",
      type: "chrome",
      source: "Pular",
      file: "src/ui/pt-PT.json",
    },
  );
  const report = applySnapshot(db, p.id, next);
  expect(report.proposalsApplied).toBe(3);
  expect(report.proposalsSuperseded).toBe(2);
  expect(pendingCount(db, p.id)).toBe(0);
  const statusOf = Object.fromEntries(
    db
      .select({ key: sourceChanges.key, status: sourceChanges.status })
      .from(sourceChanges)
      .all()
      .map((r) => [r.key, r.status]),
  );
  expect(statusOf).toEqual({
    "ui.continue": "applied",
    "skin.heard-nothing": "applied",
    "ui.back": "applied",
    "skin.seen-at-greenhouse-window": "superseded",
    "ui.skip": "superseded",
  });

  // An edit whose string is archived by a push is superseded; one whose
  // string is pushed unchanged stays pending.
  const again = row(db, "ui.back");
  proposeEdit(db, { stringRowId: again.id, text: "Recuar", actor: ana });
  const third = structuredClone(next);
  third.strings = third.strings.filter((s) => s.id !== "ui.back");
  expect(applySnapshot(db, p.id, third).proposalsSuperseded).toBe(1);
  const skip = row(db, "ui.skip");
  proposeEdit(db, { stringRowId: skip.id, text: "Saltar", actor: ana });
  expect(applySnapshot(db, p.id, third).proposalsApplied).toBe(0);
  expect(pendingCount(db, p.id)).toBe(1);
});

test("an archived string refuses proposals", () => {
  const { db, ana } = pushed();
  const ui = row(db, "ui.continue");
  db.update(strings).set({ archived: true }).where(eq(strings.id, ui.id)).run();
  expect(
    proposeEdit(db, { stringRowId: ui.id, text: "Seguir", actor: ana }),
  ).toEqual({
    ok: false,
    reason: "archived",
  });
  expect(proposeDelete(db, { stringRowId: ui.id, actor: ana })).toEqual({
    ok: false,
    reason: "archived",
  });
});

test("a newer proposal keeps the older row as superseded, a delete supersedes an edit on the same string", () => {
  const { db, ana, rui } = pushed();
  const ui = row(db, "ui.continue");
  const edit = proposeEdit(db, {
    stringRowId: ui.id,
    text: "Seguir",
    actor: ana,
  });
  if (!edit.ok) throw new Error(edit.reason);
  const del = proposeDelete(db, { stringRowId: ui.id, actor: rui });
  if (!del.ok) throw new Error(del.reason);
  const older = db
    .select()
    .from(sourceChanges)
    .where(eq(sourceChanges.id, edit.proposal.id))
    .get();
  expect(older?.status).toBe("superseded");
  expect(older?.resolvedAt).toBeInstanceOf(Date);
  expect(pendingForString(db, ui.id)?.kind).toBe("delete");
});

test("a delete whose string is pushed with other text stays pending; a dry run records no outcome", () => {
  const { db, p, ana } = pushed();
  const ui = row(db, "ui.continue");
  proposeDelete(db, { stringRowId: ui.id, actor: ana });
  const changed = structuredClone(FIXTURE);
  changed.strings.find((s) => s.id === "ui.continue")!.source = "Outro";
  expect(applySnapshot(db, p.id, changed).proposalsSuperseded).toBe(0);
  expect(pendingForString(db, ui.id)?.kind).toBe("delete");

  const removed = structuredClone(changed);
  removed.strings = removed.strings.filter((s) => s.id !== "ui.continue");
  expect(
    applySnapshot(db, p.id, removed, { dryRun: true }).proposalsApplied,
  ).toBe(1);
  expect(pendingCount(db, p.id)).toBe(1);
  expect(applySnapshot(db, p.id, removed).proposalsApplied).toBe(1);
  expect(pendingCount(db, p.id)).toBe(0);
});
