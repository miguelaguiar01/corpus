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
// The page carries the outcome in its query, never in a URL body.
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
  redirect(
    stringPath(slug, key, {
      language: field(formData, "language") || undefined,
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

// Withdraw needs no string row (a pending add has none): the project
// and the proposal id, back to the string page when the form names a
// key, to the catalogue otherwise.
export async function withdrawProposalAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const result = withdrawProposal(db, {
    proposalId: Number(field(formData, "proposalId")),
    projectId: project.id,
    actor: { id: user.id },
  });
  const key = field(formData, "key");
  const flags: Record<string, string> = result.ok
    ? { withdrawn: "1" }
    : { proposalError: result.reason };
  if (key) {
    redirect(
      stringPath(slug, key, {
        language: field(formData, "language") || undefined,
        ...flags,
      }),
    );
  }
  redirect(`/p/${slug}/catalogue?${new URLSearchParams(flags)}`);
}

export type AddState =
  | { status: "idle" }
  | {
      status: "error";
      reason: string;
      key: string;
      source: string;
      text: string;
    };

// The catalogue's "Add a string" (§9.2): key, source file, text. An
// error keeps what was typed.
export async function proposeAddAction(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const user = await requireUser();
  const db = getDb();
  const slug = field(formData, "slug");
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const key = field(formData, "key");
  const source = field(formData, "source");
  const text = field(formData, "text");
  const result = proposeAdd(db, {
    projectId: project.id,
    key,
    sourcePath: source,
    text,
    actor: { id: user.id },
  });
  if (!result.ok) {
    return { status: "error", reason: result.reason, key, source, text };
  }
  redirect(
    `/p/${slug}/catalogue?added=${encodeURIComponent(result.proposal.key)}`,
  );
}
