"use server";

import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { createProject } from "./service";

export type NewProjectState =
  | { status: "idle" }
  | { status: "created"; slug: string; token: string }
  | { status: "error"; reason: "forbidden" | "slug-taken" | "invalid" };

export async function createProjectAction(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const user = await requireUser();
  const languages = String(formData.get("languages") ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const result = createProject(
    getDb(),
    {
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      sourceLanguage: String(formData.get("sourceLanguage") ?? ""),
      languages,
    },
    user,
  );
  if (!result.ok) return { status: "error", reason: result.reason };
  return { status: "created", slug: result.project.slug, token: result.token };
}
