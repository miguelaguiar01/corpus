// The editor's save/verify decision (§9.1, §9.3, §11): validate a save
// against the contract rules, apply the action through the transition
// service, then say where to go next — the next queue item, the
// dashboard when the queue is done, or back to the same string carrying
// a typed error or the changed-since-opened warning. Pure apart from the
// DB, so the server actions stay thin wrappers.
import { validateTranslation } from "@corpus/contract";
import { neighbours, queueItems, type QueueKind } from "@/catalogue/queues";
import type { Db } from "@/db";
import { stringDetail } from "@/strings/detail";
import { stringPath } from "@/strings/paths";
import { applyTransition } from "./service";
import type { TranslationAction } from "./state";

type FlowProject = { id: number; slug: string; sourceLanguage: string };
type FlowUser = { id: number; maintainer: boolean };

export type TransitionFlowInput = {
  project: FlowProject;
  user: FlowUser;
  key: string;
  // The row acted on; also the queue item's language for positioning.
  language: string;
  action: TranslationAction;
  queue?: QueueKind;
  openedVersion?: number;
};

export type FlowResult =
  { kind: "redirect"; to: string } | { kind: "not-found" };

export function transitionFlow(db: Db, input: TransitionFlowInput): FlowResult {
  const { project, user, key, language, action } = input;
  const detail = stringDetail(db, project.id, key);
  if (!detail) return { kind: "not-found" };

  const queueParams = input.queue ? { queue: input.queue, language } : {};
  const here = (extra: Record<string, string> = {}) =>
    stringPath(project.slug, key, { ...queueParams, ...extra });
  const around = input.queue
    ? neighbours(queueItems(db, project.id, input.queue), {
        stringId: detail.string.id,
        language,
      })
    : null;

  if (action.type === "save") {
    const validation = validateTranslation(detail.string.source, action.text);
    if (!validation.ok) {
      return { kind: "redirect", to: here({ error: "invalid-translation" }) };
    }
  }

  const result = applyTransition(db, {
    stringId: detail.string.id,
    language,
    action,
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

export type VerifyFlowInput = Omit<
  TransitionFlowInput,
  "action" | "language"
> & {
  language?: string;
};

// The M2 case: sign off the source row (or any row named by language).
export function verifyFlow(db: Db, input: VerifyFlowInput): FlowResult {
  return transitionFlow(db, {
    ...input,
    language: input.language ?? input.project.sourceLanguage,
    action: { type: "verify" },
  });
}
