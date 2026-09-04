"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { isQueueKind } from "@/catalogue/queues";
import { getDb } from "@/db";
import { getProjectBySlug } from "@/projects/service";
import type { TranslationAction } from "./state";
import { transitionFlow } from "./transition-flow";

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Both editor actions share one path: session → project → flow → redirect.
// Authorization is re-derived from the session; nothing in the form is
// trusted beyond naming the row and carrying the version token.
async function act(
  formData: FormData,
  action: TranslationAction,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const project = getProjectBySlug(db, field(formData, "slug") ?? "");
  if (!project) notFound();

  const queue = field(formData, "queue");
  const opened = Number(field(formData, "openedVersion"));
  const result = transitionFlow(db, {
    project,
    user,
    key: field(formData, "key") ?? "",
    language: field(formData, "language") ?? project.sourceLanguage,
    action,
    queue: isQueueKind(queue) ? queue : undefined,
    openedVersion: Number.isFinite(opened) ? opened : undefined,
  });
  if (result.kind === "not-found") notFound();
  redirect(result.to);
}

export async function verifyString(formData: FormData): Promise<void> {
  await act(formData, { type: "verify" });
}

export async function saveString(formData: FormData): Promise<void> {
  await act(formData, { type: "save", text: field(formData, "text") ?? "" });
}
