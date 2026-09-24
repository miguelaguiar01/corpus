import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import {
  CONTINUE,
  HEARD,
  pushedProject,
  stringRowId,
} from "@/agents/test-helpers";
import { projects, strings } from "@/db/schema";
import { pendingForString } from "@/proposals/service";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { POST } = await import("./route");

function propose(token: string | undefined, key: string, body: unknown) {
  return POST(
    new Request(
      `http://corpus.test/api/strings/${encodeURIComponent(key)}/proposals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
    ),
    { params: Promise.resolve({ key }) },
  );
}

test("an edit and a removal are pending proposals by the agent actor", async () => {
  const { db, token } = seeded;
  expect((await propose(undefined, CONTINUE, { kind: "delete" })).status).toBe(
    401,
  );

  const edit = await propose(token, CONTINUE, {
    kind: "edit",
    text: "Prosseguir",
  });
  expect(edit.status).toBe(201);
  expect(await edit.json()).toMatchObject({
    kind: "edit",
    key: CONTINUE,
    file: "src/ui/pt-PT.json",
    text: "Prosseguir",
    status: "pending",
    author: "mm agent",
  });
  expect(pendingForString(db, stringRowId(db, CONTINUE))).toMatchObject({
    kind: "edit",
    author: "mm agent",
  });

  const removal = await propose(token, HEARD, { kind: "delete" });
  expect(removal.status).toBe(201);
  expect(await removal.json()).toMatchObject({ kind: "delete", key: HEARD });
});

test("the service's refusals: unchanged, invalid ICU, a source pull cannot write, a bad body, no such string", async () => {
  const { db, token } = seeded;
  const unchanged = await propose(token, CONTINUE, {
    kind: "edit",
    text: "Continuar",
  });
  expect(unchanged.status).toBe(409);
  expect((await unchanged.json()).error).toBe("unchanged");

  const invalid = await propose(token, CONTINUE, {
    kind: "edit",
    text: "{broken",
  });
  expect(invalid.status).toBe(422);
  expect((await invalid.json()).error).toBe("invalid-icu");

  db.update(strings)
    .set({ file: null })
    .where(eq(strings.id, stringRowId(db, HEARD)))
    .run();
  const exec = await propose(token, HEARD, { kind: "delete" });
  expect(exec.status).toBe(422);
  expect(await exec.json()).toEqual({
    error: "not-writable",
    message: `${HEARD} comes from a source that pull cannot write; the writable sources are src/skins/{lang}.json, src/ui/{lang}.json`,
  });

  db.update(strings)
    .set({ file: null, keyIsText: true })
    .where(eq(strings.id, stringRowId(db, HEARD)))
    .run();
  const keyed = await propose(token, HEARD, { kind: "edit", text: "Nada." });
  expect(keyed.status).toBe(422);
  expect(await keyed.json()).toEqual({
    error: "not-writable",
    message: `the text of ${HEARD} is its key: change it in the code that calls t(), and the catalogue follows`,
  });

  const bad = await propose(token, CONTINUE, { kind: "rename" });
  expect(bad.status).toBe(422);
  expect((await propose(token, "no.such", { kind: "delete" })).status).toBe(
    404,
  );
});

test("a string proposal's refusal carries the predated-push clause too", async () => {
  const { db, project, token } = seeded;
  db.update(projects)
    .set({ sources: null })
    .where(eq(projects.id, project.id))
    .run();
  const res = await propose(token, HEARD, { kind: "delete" });
  expect((await res.json()).message).toBe(
    `${HEARD} comes from a source that pull cannot write; the project was last pushed before sources were declared; run corpus push with this CLI`,
  );
});

test("an unknown field on a string proposal is refused by name", async () => {
  const { token } = seeded;
  const res = await propose(token, CONTINUE, { kind: "delete", text: "x" });
  expect(res.status).toBe(422);
  expect((await res.json()).message).toBe("unknown field text");
});
