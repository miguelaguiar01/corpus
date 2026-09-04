"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { isQueueKind } from "@/catalogue/queues";
import { getDb } from "@/db";
import { getProjectBySlug } from "@/projects/service";
import { verifyFlow } from "./verify-flow";

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function verifyString(formData: FormData): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const project = getProjectBySlug(db, field(formData, "slug") ?? "");
  if (!project) notFound();

  const queue = field(formData, "queue");
  const opened = Number(field(formData, "openedVersion"));
  const result = verifyFlow(db, {
    project,
    user,
    key: field(formData, "key") ?? "",
    queue: isQueueKind(queue) ? queue : undefined,
    language: field(formData, "language"),
    openedVersion: Number.isFinite(opened) ? opened : undefined,
  });
  if (result.kind === "not-found") notFound();
  redirect(result.to);
}
