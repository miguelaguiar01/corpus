import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { provisionProject } from "@/projects/service";
import { agentName, ensureAgentActor, isAgentName } from "./actor";

test("a project is created with its agent actor: flagged, no password, not a maintainer", () => {
  const db = memoryDb();
  const created = provisionProject(db, {
    slug: "mm",
    name: "MM",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!created.ok) throw new Error(created.reason);
  const actor = db
    .select()
    .from(users)
    .where(eq(users.name, agentName("mm")))
    .get();
  expect(actor).toMatchObject({
    name: "mm agent",
    agent: true,
    maintainer: false,
    passwordHash: null,
  });
});

test("ensureAgentActor creates the actor once for a project that predates it", () => {
  const db = memoryDb();
  const first = ensureAgentActor(db, { slug: "old" });
  const again = ensureAgentActor(db, { slug: "old" });
  expect(again.id).toBe(first.id);
  expect(db.select().from(users).all()).toHaveLength(1);
});

test("a person holding the actor's name is never mistaken for it", () => {
  const db = memoryDb();
  db.insert(users).values({ name: "old agent", maintainer: false }).run();
  expect(() => ensureAgentActor(db, { slug: "old" })).toThrow(/person/);
});

test("the agent name family is any name ending in ' agent'", () => {
  expect(isAgentName("mm agent")).toBe(true);
  expect(isAgentName("agent")).toBe(false);
  expect(isAgentName("secret agent")).toBe(true);
  expect(isAgentName("agent smith")).toBe(false);
});
