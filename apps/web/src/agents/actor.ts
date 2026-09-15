// The project's agent actor (§10): the user every write through the
// project token is attributed to. One per project, named from the slug,
// created with the project or at the first write through the token of a
// project that predates it; never signs in, never a maintainer.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";

export const AGENT_SUFFIX = " agent";

export function agentName(slug: string): string {
  return `${slug}${AGENT_SUFFIX}`;
}

// The name family is reserved for actors, so the join form can refuse
// it before any project needs it.
export function isAgentName(name: string): boolean {
  return name.endsWith(AGENT_SUFFIX);
}

export type AgentActor = { id: number; name: string; maintainer: false };

export function ensureAgentActor(
  db: Db,
  project: { slug: string },
): AgentActor {
  const name = agentName(project.slug);
  const existing = db.select().from(users).where(eq(users.name, name)).get();
  if (existing) {
    if (!existing.agent) {
      throw new Error(`${name} is a person, not the project's agent actor`);
    }
    return { id: existing.id, name, maintainer: false };
  }
  const created = db
    .insert(users)
    .values({ name, agent: true, maintainer: false })
    .returning()
    .get();
  return { id: created.id, name, maintainer: false };
}
