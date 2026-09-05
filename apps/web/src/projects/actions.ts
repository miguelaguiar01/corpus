"use server";

import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NEW_TOKEN_COOKIE } from "./constants";
import { createProject, getProjectBySlug } from "./service";
import { rotateToken, setMaintainer, updateLanguages } from "./settings";

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

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function settingsPath(
  slug: string,
  query: Record<string, string> = {},
): string {
  const params = new URLSearchParams(query);
  return `/p/${slug}/settings${params.size ? `?${params}` : ""}`;
}

// The maintainer corner's actions (§9.5). Authorization is re-derived
// from the session and re-checked in the services; the form only names
// the project and the change.
export async function rotateProjectToken(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const result = rotateToken(db, project.id, user);
  if (!result.ok) redirect(settingsPath(slug, { error: result.reason }));
  // Shown once: carried to the page in a short-lived HttpOnly cookie
  // scoped to the settings path, never in a URL that proxies would log.
  const jar = await cookies();
  jar.set(NEW_TOKEN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/p/${slug}/settings`,
    maxAge: 60,
  });
  redirect(settingsPath(slug, { token: "1" }));
}

export async function saveLanguages(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const targets = field(formData, "languages")
    .split(",")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const result = updateLanguages(db, project.id, targets, user);
  redirect(
    settingsPath(
      slug,
      result.ok ? { saved: "languages" } : { error: result.reason },
    ),
  );
}

export async function toggleMaintainer(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  if (!getProjectBySlug(db, slug)) notFound();
  const userId = Number(field(formData, "userId"));
  const maintainer = field(formData, "maintainer") === "1";
  const result = setMaintainer(db, userId, maintainer, user);
  redirect(
    settingsPath(
      slug,
      result.ok ? { saved: "users" } : { error: result.reason },
    ),
  );
}
