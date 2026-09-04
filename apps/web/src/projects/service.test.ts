import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject, findProjectByToken } from "./service";

function db() {
  return memoryDb();
}

function maintainer(d = db()) {
  const [u] = d
    .insert(users)
    .values({ name: "boss", maintainer: true })
    .returning()
    .all();
  if (!u) throw new Error("seed failed");
  return { d, actor: u };
}

const INPUT = {
  slug: "moonlight-manor",
  name: "Moonlight Manor",
  sourceLanguage: "pt-PT",
  languages: ["pt-PT", "en"],
};

test("a non-maintainer cannot create a project", () => {
  const d = db();
  const [u] = d.insert(users).values({ name: "joe" }).returning().all();
  if (!u) throw new Error("seed failed");
  const result = createProject(d, INPUT, u);
  expect(result.ok).toBe(false);
  expect(d.select().from(users).all()).toHaveLength(1);
});

test("a maintainer creates a project and gets a token once", () => {
  const { d, actor } = maintainer();
  const result = createProject(d, INPUT, actor);
  if (!result.ok) throw new Error(result.reason);
  expect(result.token).toMatch(/^[0-9a-f]{48}$/);
  expect(result.project.slug).toBe("moonlight-manor");
});

test("only the token hash is stored, never the plaintext", () => {
  const { d, actor } = maintainer();
  const result = createProject(d, INPUT, actor);
  if (!result.ok) throw new Error(result.reason);
  expect(result.project.tokenHash).not.toBe(result.token);
  expect(result.project.tokenHash).not.toContain(result.token);
});

test("the issued token resolves back to its project", () => {
  const { d, actor } = maintainer();
  const result = createProject(d, INPUT, actor);
  if (!result.ok) throw new Error(result.reason);
  expect(findProjectByToken(d, result.token)?.id).toBe(result.project.id);
});

test("an unknown token resolves to no project", () => {
  const { d } = maintainer();
  expect(findProjectByToken(d, "deadbeef")).toBeUndefined();
});

test("duplicate slug is rejected", () => {
  const { d, actor } = maintainer();
  createProject(d, INPUT, actor);
  const again = createProject(d, INPUT, actor);
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.reason).toBe("slug-taken");
});

test.each([
  ["empty slug", { ...INPUT, slug: "" }],
  ["empty name", { ...INPUT, name: " " }],
  ["no languages", { ...INPUT, languages: [] }],
  ["languages missing source", { ...INPUT, languages: ["en"] }],
])("rejects invalid input: %s", (_label, input) => {
  const { d, actor } = maintainer();
  const result = createProject(d, input, actor);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("invalid");
});
