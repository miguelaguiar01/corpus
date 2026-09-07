import { getDb } from "@/db";
import { MAX_PROJECT_BODY_BYTES } from "@/api/limits";
import { authenticateInstanceSecret } from "@/api/secret";
import { provisionProject } from "@/projects/service";

type Body = {
  slug: string;
  name: string;
  sourceLanguage: string;
  languages: string[];
};

function isBody(value: unknown): value is Body {
  const v = value as Partial<Body> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    typeof v.sourceLanguage === "string" &&
    Array.isArray(v.languages) &&
    v.languages.every((l) => typeof l === "string")
  );
}

function bad(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

// Creates a project with the instance secret (§10); the token is
// returned once, as from the maintainer corner.
export async function POST(request: Request): Promise<Response> {
  const auth = authenticateInstanceSecret(request);
  if (!auth.ok) return auth.response;

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_PROJECT_BODY_BYTES) {
    return bad(
      413,
      "payload-too-large",
      `body exceeds ${MAX_PROJECT_BODY_BYTES} bytes`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad(400, "bad-request", "body is not valid JSON");
  }
  if (!isBody(body)) {
    return bad(
      422,
      "invalid",
      "body needs slug, name, sourceLanguage and languages (strings)",
    );
  }

  const result = provisionProject(getDb(), body);
  if (!result.ok) {
    if (result.reason === "slug-taken") {
      return bad(409, "slug-taken", `a project named ${body.slug} exists`);
    }
    return bad(
      422,
      "invalid",
      "slug is lowercase letters, digits and hyphens; name is not empty; languages are language codes and include sourceLanguage",
    );
  }
  return Response.json(
    { slug: result.project.slug, token: result.token },
    { status: 201 },
  );
}
