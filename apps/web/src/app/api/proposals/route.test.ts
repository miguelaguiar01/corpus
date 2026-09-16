import { expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { CONTINUE, pushedProject } from "@/agents/test-helpers";
import { projects } from "@/db/schema";
import { applySnapshot } from "@/ingest/apply";
import { FIXTURE } from "@/agents/test-helpers";
import { pendingAdds } from "@/proposals/service";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { POST } = await import("./route");

function add(token: string | undefined, body: unknown) {
  return POST(
    new Request("http://corpus.test/api/proposals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

test("a new string into a writable source is a pending add by the agent actor", async () => {
  const { db, project, token } = seeded;
  expect((await add(undefined, {})).status).toBe(401);
  const res = await add(token, {
    key: "ui.back",
    file: "src/ui/pt-PT.json",
    text: "Voltar",
  });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({
    kind: "add",
    key: "ui.back",
    file: "src/ui/pt-PT.json",
    text: "Voltar",
    status: "pending",
    author: "mm agent",
  });
  expect(pendingAdds(db, project.id).map((p) => p.key)).toEqual(["ui.back"]);
});

test("an existing key, an unknown file, a bad key and a bad body are refused", async () => {
  const { token } = seeded;
  const exists = await add(token, {
    key: CONTINUE,
    file: "src/ui/pt-PT.json",
    text: "x",
  });
  expect(exists.status).toBe(409);
  expect((await exists.json()).error).toBe("exists");
  const unknown = await add(token, {
    key: "ui.next",
    file: "src/nope/pt-PT.json",
    text: "x",
  });
  expect(unknown.status).toBe(422);
  expect((await unknown.json()).error).toBe("unknown-source");
  const badKey = await add(token, {
    key: "ui next",
    file: "src/ui/pt-PT.json",
    text: "x",
  });
  expect(badKey.status).toBe(422);
  expect((await add(token, { key: "ui.next" })).status).toBe(422);
});

test("the refusal says when the project has no writable source, or was pushed before any were declared", async () => {
  const { db, project, token } = seeded;
  const attempt = () =>
    add(token, { key: "ui.next", file: "src/ui/pt-PT.json", text: "x" });
  db.update(projects)
    .set({ sources: [] })
    .where(eq(projects.id, project.id))
    .run();
  expect((await (await attempt()).json()).message).toBe(
    "the file is not a writable source of the project; the project has no writable source",
  );
  db.update(projects)
    .set({ sources: null })
    .where(eq(projects.id, project.id))
    .run();
  expect((await (await attempt()).json()).message).toBe(
    "the file is not a writable source of the project; the project was last pushed before sources were declared; run corpus push with this CLI",
  );
});

test("a push with nothing writable lands as an empty list, not as a predated push", async () => {
  const { db, project, token } = seeded;
  applySnapshot(db, project.id, { ...FIXTURE, sources: [] });
  const res = await add(token, {
    key: "ui.next",
    file: "src/ui/pt-PT.json",
    text: "x",
  });
  expect((await res.json()).message).toBe(
    "the file is not a writable source of the project; the project has no writable source",
  );
  applySnapshot(db, project.id, FIXTURE);
});
