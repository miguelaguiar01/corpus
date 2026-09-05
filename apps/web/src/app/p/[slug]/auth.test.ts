import { expect, test, vi } from "vitest";

// Every project page must authenticate itself (§10): the layout is not
// a boundary. The session guard is replaced by one that throws, and each
// page must throw before it touches anything else.
const GUARD = new Error("no session");
vi.mock("@/auth/session", () => ({
  requireUser: vi.fn(async () => {
    throw GUARD;
  }),
  currentUser: vi.fn(async () => undefined),
}));
vi.mock("@/db", () => ({
  getDb: () => {
    throw new Error("the database was reached before the session check");
  },
}));

const params = Promise.resolve({ slug: "mm", stringId: "x" });
const searchParams = Promise.resolve({});

test.each([
  ["overview", () => import("./page")],
  ["catalogue", () => import("./catalogue/page")],
  ["entities", () => import("./entities/page")],
  ["string", () => import("./s/[stringId]/page")],
])("the %s page refuses to render without a session", async (_, load) => {
  const page = (await load()).default as (props: {
    params: typeof params;
    searchParams: typeof searchParams;
  }) => Promise<unknown>;
  await expect(page({ params, searchParams })).rejects.toBe(GUARD);
});
