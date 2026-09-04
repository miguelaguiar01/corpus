// The verify action's decision (§9.1, §9.3): apply the source-language
// sign-off through the transition service, then say where to go next —
// the next queue item, the dashboard when the queue is done, or back to
// the same string carrying an error or the changed-since-opened warning.
// Pure apart from the DB, so the server action stays a thin wrapper.
import { neighbours, queueItems, type QueueKind } from "@/catalogue/queues";
import type { Db } from "@/db";
import { stringDetail } from "@/strings/detail";
import { stringPath } from "@/strings/paths";
import { applyTransition } from "./service";

export type VerifyFlowInput = {
  project: { id: number; slug: string; sourceLanguage: string };
  user: { id: number; maintainer: boolean };
  key: string;
  queue?: QueueKind;
  // The queue item's language (the source language for unverified source;
  // a target for the other queues). Only used to locate the item.
  language?: string;
  openedVersion?: number;
};

export type VerifyFlowResult =
  { kind: "redirect"; to: string } | { kind: "not-found" };

export function verifyFlow(db: Db, input: VerifyFlowInput): VerifyFlowResult {
  const { project, user, key } = input;
  const detail = stringDetail(db, project.id, key);
  if (!detail) return { kind: "not-found" };

  const language = input.language ?? project.sourceLanguage;
  const queueParams = input.queue ? { queue: input.queue, language } : {};
  const here = (extra: Record<string, string> = {}) =>
    stringPath(project.slug, key, { ...queueParams, ...extra });
  const around = input.queue
    ? neighbours(queueItems(db, project.id, input.queue), {
        stringId: detail.string.id,
        language,
      })
    : null;

  const result = applyTransition(db, {
    stringId: detail.string.id,
    language: project.sourceLanguage,
    action: { type: "verify" },
    actor: user,
    openedVersion: input.openedVersion,
  });
  if ("error" in result)
    return { kind: "redirect", to: here({ error: result.error }) };
  if (result.changedSinceOpened) {
    return { kind: "redirect", to: here({ warning: "changed" }) };
  }
  if (!input.queue)
    return { kind: "redirect", to: stringPath(project.slug, key) };
  if (around?.next) {
    return {
      kind: "redirect",
      to: stringPath(project.slug, around.next.key, {
        queue: input.queue,
        language: around.next.language,
      }),
    };
  }
  return { kind: "redirect", to: `/p/${project.slug}` };
}
