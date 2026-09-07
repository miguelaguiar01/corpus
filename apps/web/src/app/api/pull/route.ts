import { MIN_STATES, type MinState } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { pullPayload } from "@/pull/payload";

function isMinState(value: string): value is MinState {
  return (MIN_STATES as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const minState = params.get("minState") ?? "verified";
  if (!isMinState(minState)) {
    return Response.json(
      {
        error: "bad-request",
        message: `minState must be one of ${MIN_STATES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  // `lang` (repeatable) narrows the payload to those target languages
  // (§8); the source language is never pulled.
  const langs = params.getAll("lang");
  const unknown = langs.filter((l) => !auth.project.languages.includes(l));
  if (unknown.length > 0 || langs.includes(auth.project.sourceLanguage)) {
    return Response.json(
      {
        error: "bad-request",
        message: `lang must name a target language of the project (${auth.project.languages.filter((l) => l !== auth.project.sourceLanguage).join(", ")})`,
      },
      { status: 422 },
    );
  }
  return Response.json(
    pullPayload(
      db,
      auth.project,
      minState,
      langs.length > 0 ? langs : undefined,
    ),
  );
}
