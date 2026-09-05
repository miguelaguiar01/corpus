import { LANGUAGE_RE } from "@corpus/contract";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { projects, users } from "@/db/schema";

type User = typeof users.$inferSelect;

export type Project = typeof projects.$inferSelect;

export type CreateProjectInput = {
  slug: string;
  name: string;
  sourceLanguage: string;
  languages: string[];
};

export type CreateProjectResult =
  | { ok: true; project: Project; token: string }
  | { ok: false; reason: "forbidden" | "slug-taken" | "invalid" };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Per-project bearer token (§10): created at project creation, returned
// once, only its hash persisted.
// The slug is a path segment and a config value (§3): lowercase, digits,
// hyphens, at most 63 characters.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function createProject(
  db: Db,
  input: CreateProjectInput,
  actor: User,
): CreateProjectResult {
  if (!actor.maintainer) return { ok: false, reason: "forbidden" };

  const slug = input.slug.trim();
  const name = input.name.trim();
  if (
    !SLUG_RE.test(slug) ||
    name.length === 0 ||
    input.languages.length === 0 ||
    !input.languages.every((l) => LANGUAGE_RE.test(l)) ||
    !input.languages.includes(input.sourceLanguage)
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (db.select().from(projects).where(eq(projects.slug, slug)).get()) {
    return { ok: false, reason: "slug-taken" };
  }

  const token = randomBytes(24).toString("hex");
  const project = db
    .insert(projects)
    .values({
      slug,
      name,
      sourceLanguage: input.sourceLanguage,
      languages: input.languages,
      tokenHash: hashToken(token),
    })
    .returning()
    .get();
  return { ok: true, project, token };
}

export function findProjectByToken(db: Db, token: string): Project | undefined {
  return db
    .select()
    .from(projects)
    .where(eq(projects.tokenHash, hashToken(token)))
    .get();
}

// Everyone sees all projects on the instance (§10).
export function listProjects(db: Db): Project[] {
  return db.select().from(projects).orderBy(projects.name).all();
}

export function getProjectBySlug(db: Db, slug: string): Project | undefined {
  return db.select().from(projects).where(eq(projects.slug, slug)).get();
}
