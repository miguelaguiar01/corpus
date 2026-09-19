import { expect, test, vi } from "vitest";
import { ensureAgentActor } from "@/agents/actor";
import {
  CONTINUE,
  HEARD,
  pushedProject,
  stringRowId,
} from "@/agents/test-helpers";
import { pendingForString, proposeEdit } from "@/proposals/service";
import { provisionProject } from "@/projects/service";

const seeded = pushedProject();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => seeded.db,
}));

const { DELETE } = await import("./route");

function withdraw(token: string | undefined, id: string) {
  return DELETE(
    new Request(`http://corpus.test/api/proposals/${id}`, {
      method: "DELETE",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("the agent withdraws its own pending proposal once; a person's, a missing one and a bad id are refused", async () => {
  const { db, project, token, rui } = seeded;
  const agent = ensureAgentActor(db, project);
  const own = proposeEdit(db, {
    stringRowId: stringRowId(db, CONTINUE),
    text: "Seguir",
    actor: agent,
  });
  const theirs = proposeEdit(db, {
    stringRowId: stringRowId(db, HEARD),
    text: "Nada.",
    actor: rui,
  });
  if (!own.ok || !theirs.ok) throw new Error("seed failed");

  expect((await withdraw(undefined, String(own.proposal.id))).status).toBe(401);

  const ok = await withdraw(token, String(own.proposal.id));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ id: own.proposal.id, status: "withdrawn" });
  expect(pendingForString(db, stringRowId(db, CONTINUE))).toBeUndefined();

  const again = await withdraw(token, String(own.proposal.id));
  expect(again.status).toBe(409);
  expect((await again.json()).error).toBe("not-pending");

  const forbidden = await withdraw(token, String(theirs.proposal.id));
  expect(forbidden.status).toBe(403);
  expect((await forbidden.json()).error).toBe("forbidden");
  expect(pendingForString(db, stringRowId(db, HEARD))).toBeDefined();

  expect((await withdraw(token, "999")).status).toBe(404);
  expect((await withdraw(token, "abc")).status).toBe(404);

  // Another project's token never reaches this project's proposals.
  const other = provisionProject(db, {
    slug: "other",
    name: "Other",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
  });
  if (!other.ok) throw new Error(other.reason);
  expect((await withdraw(other.token, String(theirs.proposal.id))).status).toBe(
    404,
  );
});
