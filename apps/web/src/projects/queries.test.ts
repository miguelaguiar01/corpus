import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject, getProjectBySlug, listProjects } from "./service";

function seeded() {
  const db = memoryDb();
  const [actor] = db
    .insert(users)
    .values({ name: "boss", maintainer: true })
    .returning()
    .all();
  if (!actor) throw new Error("seed failed");
  for (const { slug, name } of [
    { slug: "beta", name: "Beta" },
    { slug: "alpha", name: "Alpha" },
  ]) {
    createProject(
      db,
      { slug, name, sourceLanguage: "en", languages: ["en"] },
      actor,
    );
  }
  return db;
}

test("listProjects returns all projects ordered by name", () => {
  const db = seeded();
  expect(listProjects(db).map((p) => p.name)).toEqual(["Alpha", "Beta"]);
});

test("getProjectBySlug resolves a known slug", () => {
  const db = seeded();
  expect(getProjectBySlug(db, "alpha")?.name).toBe("Alpha");
});

test("getProjectBySlug returns undefined for an unknown slug", () => {
  const db = seeded();
  expect(getProjectBySlug(db, "ghost")).toBeUndefined();
});
