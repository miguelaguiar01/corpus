import { expect, test } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject } from "@/projects/service";
import { authenticateProject } from "./bearer";

function withProject() {
  const db = memoryDb();
  const [actor] = db
    .insert(users)
    .values({ name: "boss", maintainer: true })
    .returning()
    .all();
  if (!actor) throw new Error("seed failed");
  const created = createProject(
    db,
    {
      slug: "moonlight-manor",
      name: "Moonlight Manor",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    },
    actor,
  );
  if (!created.ok) throw new Error(created.reason);
  return { db, token: created.token, project: created.project };
}

function req(auth?: string) {
  return new Request("http://corpus.test/api/push", {
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

test("a valid bearer token authenticates its project", async () => {
  const { db, token, project } = withProject();
  const result = authenticateProject(db, req(`Bearer ${token}`));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.project.id).toBe(project.id);
});

test("a missing Authorization header is 401 with a machine body", async () => {
  const { db } = withProject();
  const result = authenticateProject(db, req());
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({
      error: "unauthorized",
    });
  }
});

test.each([
  ["no scheme", "abc123"],
  ["wrong scheme", "Basic abc123"],
  ["empty token", "Bearer "],
])("a malformed header (%s) is 401", (_label, header) => {
  const { db } = withProject();
  const result = authenticateProject(db, req(header));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(401);
});

test("an unknown token is 401", () => {
  const { db } = withProject();
  const result = authenticateProject(db, req("Bearer deadbeefdeadbeef"));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.response.status).toBe(401);
});

test("a token authenticates its own project, not another", () => {
  const { db, token } = withProject();
  const [actor] = db.select().from(users).all();
  if (!actor) throw new Error("no actor");
  const other = createProject(
    db,
    { slug: "other", name: "Other", sourceLanguage: "en", languages: ["en"] },
    actor,
  );
  if (!other.ok) throw new Error(other.reason);
  const result = authenticateProject(db, req(`Bearer ${token}`));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.project.slug).toBe("moonlight-manor");
});
