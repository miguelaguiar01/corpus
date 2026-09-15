// A draft through the project token (§10): the editor's save, under the
// rule that an agent never overwrites a person's current work. Accepted
// on an untranslated row, a stale row, or a translated row the agent
// last edited; refused, plainly, on anything else.
import { validateTranslation } from "@corpus/contract";
import type { Db } from "@/db";
import type { Project } from "@/projects/service";
import { stringDetail, type StringDetail } from "@/strings/detail";
import { applyTransition } from "@/translations/service";
import { validationMessage } from "@/translations/validation-message";
import { ensureAgentActor } from "./actor";

export type DraftRefusal =
  | { reason: "not-found" }
  | { reason: "unknown-language" }
  | { reason: "source-row" }
  | { reason: "archived" }
  | { reason: "empty-text" }
  | { reason: "invalid-translation"; message: string }
  | { reason: "human-edited" };

export type DraftResult =
  | {
      ok: true;
      key: string;
      language: string;
      state: "translated";
      text: string;
      actor: string;
    }
  | ({ ok: false } & DraftRefusal);

function openToAgent(row: StringDetail["translations"][string]): boolean {
  return row.state === "untranslated" || row.stale || row.agentDraft;
}

export function agentDraft(
  db: Db,
  input: { project: Project; key: string; language: string; text: string },
): DraftResult {
  const { project, key, language, text } = input;
  if (!project.languages.includes(language))
    return { ok: false, reason: "unknown-language" };
  if (language === project.sourceLanguage)
    return { ok: false, reason: "source-row" };
  const detail = stringDetail(db, project.id, key);
  if (!detail) return { ok: false, reason: "not-found" };
  if (detail.string.archived) return { ok: false, reason: "archived" };
  if (text.trim() === "") return { ok: false, reason: "empty-text" };
  const validation = validateTranslation(detail.string.source, text);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid-translation",
      message: validation.errors.map(validationMessage).join("; "),
    };
  }
  const row = detail.translations[language];
  // A language added to the project has its rows at once (§9.5); none
  // here means the string is not in the project's list.
  if (!row) return { ok: false, reason: "not-found" };
  if (!openToAgent(row)) return { ok: false, reason: "human-edited" };

  const actor = ensureAgentActor(db, project);
  const result = applyTransition(db, {
    stringId: detail.string.id,
    language,
    action: { type: "save", text },
    actor,
  });
  if ("error" in result) {
    if (result.error === "archived") return { ok: false, reason: "archived" };
    if (result.error === "empty-text")
      return { ok: false, reason: "empty-text" };
    if (result.error === "source-row")
      return { ok: false, reason: "source-row" };
    return { ok: false, reason: "not-found" };
  }
  return {
    ok: true,
    key,
    language,
    state: "translated",
    text,
    actor: actor.name,
  };
}
