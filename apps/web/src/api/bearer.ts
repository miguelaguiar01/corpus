import type { Db } from "@/db";
import { findProjectByToken, type Project } from "@/projects/service";

export type ProjectAuth =
  { ok: true; project: Project } | { ok: false; response: Response };

function unauthorized(message: string): Response {
  return Response.json({ error: "unauthorized", message }, { status: 401 });
}

function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1]?.trim() || undefined;
}

// Single auth path for token routes (§10). The token is hashed before
// the DB lookup, so no raw secret is compared and lookup timing reveals
// nothing about it. A token authenticates whichever project owns it;
// callers that know the target project (e.g. push, from the snapshot
// body) must check the slug matches.
export function authenticateProject(db: Db, request: Request): ProjectAuth {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token)
    return { ok: false, response: unauthorized("missing bearer token") };

  const project = findProjectByToken(db, token);
  if (!project) return { ok: false, response: unauthorized("invalid token") };

  return { ok: true, project };
}
