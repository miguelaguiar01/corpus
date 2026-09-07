"use server";

import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/session";
import { getDb } from "@/db";
import { getProjectBySlug } from "@/projects/service";
import { stringPath } from "@/strings/paths";
import { stringDetail } from "@/strings/detail";
import {
  proposeAdd,
  proposeDelete,
  proposeEdit,
  withdrawProposal,
} from "./service";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// Proposals (§11) by anyone signed in; the service re-checks every rule.
// The string page carries the outcome in its query, never in a URL body.
async function onString(
  formData: FormData,
  act: (
    stringRowId: number,
    actorId: number,
  ) => { ok: true } | { ok: false; reason: string },
): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const key = field(formData, "key");
  const detail = stringDetail(db, project.id, key);
  if (!detail) notFound();
  const result = act(detail.string.id, user.id);
  const language = field(formData, "language") || undefined;
  redirect(
    stringPath(slug, key, {
      language,
      ...(result.ok ? { proposed: "1" } : { proposalError: result.reason }),
    }),
  );
}

export async function proposeEditAction(formData: FormData): Promise<void> {
  await onString(formData, (stringRowId, actorId) =>
    proposeEdit(getDb(), {
      stringRowId,
      text: field(formData, "text"),
      actor: { id: actorId },
    }),
  );
}

export async function proposeDeleteAction(formData: FormData): Promise<void> {
  await onString(formData, (stringRowId, actorId) =>
    proposeDelete(getDb(), { stringRowId, actor: { id: actorId } }),
  );
}

export async function withdrawProposalAction(
  formData: FormData,
): Promise<void> {
  const proposalId = Number(field(formData, "proposalId"));
  await onString(formData, (_stringRowId, actorId) =>
    withdrawProposal(getDb(), { proposalId, actor: { id: actorId } }),
  );
}

export type AddState = { status: "idle" } | { status: "error"; reason: string };

// The catalogue's "Add a string" (§9.2): key, source file, text.
export async function proposeAddAction(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const result = proposeAdd(db, {
    projectId: project.id,
    key: field(formData, "key"),
    sourcePath: field(formData, "source"),
    text: field(formData, "text"),
    actor: { id: user.id },
  });
  if (!result.ok) return { status: "error", reason: result.reason };
  redirect(
    `/p/${slug}/catalogue?added=${encodeURIComponent(result.proposal.key)}`,
  );
}
