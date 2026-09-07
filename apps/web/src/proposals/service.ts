import { and, count, desc, eq } from "drizzle-orm";
import {
  parseIcu,
  stringEntrySchema,
  type SourceChange,
} from "@corpus/contract";
import type { Db } from "@/db";
import { projects, sourceChanges, strings, users } from "@/db/schema";

// Proposals (§11): a change to a source text, a new string, or a
// removal, by anyone, pending until pull writes it and a push confirms
// it (§8). Nothing here touches a translation or a state.

export type ProposalKind = "edit" | "add" | "delete";
export type Proposal = typeof sourceChanges.$inferSelect;

type Actor = { id: number };

export type ProposeResult =
  | { ok: true; proposal: Proposal }
  | {
      ok: false;
      reason:
        | "not-found"
        | "archived"
        | "not-writable"
        | "invalid-icu"
        | "invalid-key"
        | "unchanged"
        | "exists"
        | "unknown-source";
    };

function validIcu(text: string): boolean {
  return text.trim() !== "" && parseIcu(text).ok;
}

// One pending proposal per string or key (§11): a newer one replaces
// the older, which is marked superseded so the author can see why.
function supersedePending(db: Db, projectId: number, key: string): void {
  db.update(sourceChanges)
    .set({ status: "superseded", resolvedAt: new Date() })
    .where(
      and(
        eq(sourceChanges.projectId, projectId),
        eq(sourceChanges.key, key),
        eq(sourceChanges.status, "pending"),
      ),
    )
    .run();
}

function forString(
  db: Db,
  stringRowId: number,
  actor: Actor,
  kind: "edit" | "delete",
  text?: string,
): ProposeResult {
  const row = db
    .select()
    .from(strings)
    .where(eq(strings.id, stringRowId))
    .get();
  if (!row) return { ok: false, reason: "not-found" };
  if (row.archived) return { ok: false, reason: "archived" };
  if (!row.file) return { ok: false, reason: "not-writable" };
  if (kind === "edit") {
    if (text === undefined || !validIcu(text))
      return { ok: false, reason: "invalid-icu" };
    if (text === row.source) return { ok: false, reason: "unchanged" };
  }
  return db.transaction((tx) => {
    supersedePending(tx, row.projectId, row.stringId);
    const proposal = tx
      .insert(sourceChanges)
      .values({
        projectId: row.projectId,
        kind,
        stringRowId: row.id,
        key: row.stringId,
        type: row.type,
        file: row.file!,
        text: kind === "edit" ? text! : null,
        authorId: actor.id,
      })
      .returning()
      .get();
    return { ok: true, proposal };
  });
}

export function proposeEdit(
  db: Db,
  input: { stringRowId: number; text: string; actor: Actor },
): ProposeResult {
  return forString(db, input.stringRowId, input.actor, "edit", input.text);
}

export function proposeDelete(
  db: Db,
  input: { stringRowId: number; actor: Actor },
): ProposeResult {
  return forString(db, input.stringRowId, input.actor, "delete");
}

// A new string goes into one of the writable sources push declared
// (§9.2); the file stored is the source-language path pull writes.
export function proposeAdd(
  db: Db,
  input: {
    projectId: number;
    key: string;
    sourcePath: string;
    text: string;
    actor: Actor;
  },
): ProposeResult {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) return { ok: false, reason: "not-found" };
  const key = input.key.trim();
  if (!stringEntrySchema.shape.id.safeParse(key).success)
    return { ok: false, reason: "invalid-key" };
  const source = (project.sources ?? []).find(
    (s) => s.path === input.sourcePath,
  );
  if (!source) return { ok: false, reason: "unknown-source" };
  if (!validIcu(input.text)) return { ok: false, reason: "invalid-icu" };
  const existing = db
    .select({ id: strings.id })
    .from(strings)
    .where(and(eq(strings.projectId, project.id), eq(strings.stringId, key)))
    .get();
  if (existing) return { ok: false, reason: "exists" };
  return db.transaction((tx) => {
    supersedePending(tx, project.id, key);
    const proposal = tx
      .insert(sourceChanges)
      .values({
        projectId: project.id,
        kind: "add",
        stringRowId: null,
        key,
        type: source.type,
        file: source.path.replace("{lang}", project.sourceLanguage),
        text: input.text,
        authorId: input.actor.id,
      })
      .returning()
      .get();
    return { ok: true, proposal };
  });
}

export type WithdrawResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "forbidden" | "not-pending" };

// The author withdraws their own proposal; a maintainer anyone's.
export function withdrawProposal(
  db: Db,
  input: { proposalId: number; projectId: number; actor: Actor },
): WithdrawResult {
  const proposal = db
    .select()
    .from(sourceChanges)
    .where(
      and(
        eq(sourceChanges.id, input.proposalId),
        eq(sourceChanges.projectId, input.projectId),
      ),
    )
    .get();
  if (!proposal) return { ok: false, reason: "not-found" };
  if (proposal.status !== "pending")
    return { ok: false, reason: "not-pending" };
  const actor = db
    .select({ maintainer: users.maintainer })
    .from(users)
    .where(eq(users.id, input.actor.id))
    .get();
  if (proposal.authorId !== input.actor.id && !actor?.maintainer)
    return { ok: false, reason: "forbidden" };
  db.update(sourceChanges)
    .set({ status: "withdrawn", resolvedAt: new Date() })
    .where(eq(sourceChanges.id, proposal.id))
    .run();
  return { ok: true };
}

export function pendingProposals(db: Db, projectId: number): Proposal[] {
  return db
    .select()
    .from(sourceChanges)
    .where(
      and(
        eq(sourceChanges.projectId, projectId),
        eq(sourceChanges.status, "pending"),
      ),
    )
    .orderBy(sourceChanges.createdAt)
    .all();
}

export function pendingCount(db: Db, projectId: number): number {
  return (
    db
      .select({ n: count() })
      .from(sourceChanges)
      .where(
        and(
          eq(sourceChanges.projectId, projectId),
          eq(sourceChanges.status, "pending"),
        ),
      )
      .get()?.n ?? 0
  );
}

// The pending proposal on a string, with its author's name, for the
// string page; the pending keys of a project, for the catalogue's marks.
export function pendingForString(
  db: Db,
  stringRowId: number,
): (Proposal & { author: string }) | undefined {
  const row = db
    .select({ proposal: sourceChanges, author: users.name })
    .from(sourceChanges)
    .innerJoin(users, eq(users.id, sourceChanges.authorId))
    .where(
      and(
        eq(sourceChanges.stringRowId, stringRowId),
        eq(sourceChanges.status, "pending"),
      ),
    )
    .get();
  return row ? { ...row.proposal, author: row.author } : undefined;
}

// Every proposal on a key, newest first, so an author sees why one
// lost (§11); by key, so a landed add reads in its string's history.
export function proposalsForKey(
  db: Db,
  projectId: number,
  key: string,
): (Proposal & { author: string })[] {
  return db
    .select({ proposal: sourceChanges, author: users.name })
    .from(sourceChanges)
    .innerJoin(users, eq(users.id, sourceChanges.authorId))
    .where(
      and(eq(sourceChanges.projectId, projectId), eq(sourceChanges.key, key)),
    )
    .orderBy(desc(sourceChanges.createdAt), desc(sourceChanges.id))
    .all()
    .map((row) => ({ ...row.proposal, author: row.author }));
}

// The pending adds, with their authors, for the catalogue: they have
// no row yet, so the list shows them itself.
export function pendingAdds(
  db: Db,
  projectId: number,
): (Proposal & { author: string })[] {
  return db
    .select({ proposal: sourceChanges, author: users.name })
    .from(sourceChanges)
    .innerJoin(users, eq(users.id, sourceChanges.authorId))
    .where(
      and(
        eq(sourceChanges.projectId, projectId),
        eq(sourceChanges.kind, "add"),
        eq(sourceChanges.status, "pending"),
      ),
    )
    .orderBy(sourceChanges.createdAt)
    .all()
    .map((row) => ({ ...row.proposal, author: row.author }));
}

export function pendingKeys(db: Db, projectId: number): Set<string> {
  return new Set(pendingProposals(db, projectId).map((p) => p.key));
}

// What pull writes (§8): every pending proposal as a source change.
export function sourceChangesFor(db: Db, projectId: number): SourceChange[] {
  return pendingProposals(db, projectId).map((p) => ({
    kind: p.kind,
    id: p.key,
    type: p.type,
    file: p.file,
    ...(p.text !== null ? { text: p.text } : {}),
  }));
}

// After a push applied its diff (§8): an edit whose text is now the
// source, an add whose key now exists with the proposed text, a delete
// whose key is now gone are applied; an edit whose string was pushed
// with some other text than before or archived, and an add whose key
// arrived with other text, are superseded; the rest stay pending.
export function reconcileProposals(
  db: Db,
  projectId: number,
  before: Map<string, string>,
  pushed: Map<string, string>,
): { applied: number; superseded: number } {
  const pending = pendingProposals(db, projectId);
  let applied = 0;
  let superseded = 0;
  const resolve = (id: number, status: "applied" | "superseded") => {
    db.update(sourceChanges)
      .set({ status, resolvedAt: new Date() })
      .where(eq(sourceChanges.id, id))
      .run();
    if (status === "applied") applied += 1;
    else superseded += 1;
  };
  for (const p of pending) {
    const now = pushed.get(p.key);
    if (p.kind === "add") {
      if (now === p.text) resolve(p.id, "applied");
      else if (now !== undefined) resolve(p.id, "superseded");
    } else if (p.kind === "delete") {
      if (now === undefined) resolve(p.id, "applied");
    } else if (now === p.text) {
      resolve(p.id, "applied");
    } else if (now === undefined || now !== before.get(p.key)) {
      resolve(p.id, "superseded");
    }
  }
  return { applied, superseded };
}
