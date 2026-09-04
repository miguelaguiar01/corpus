"use client";

import { useRef, useState } from "react";
import { validateTranslation } from "@corpus/contract";
import type { QueueKind } from "@/catalogue/queues";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { insertAtCaret } from "@/translations/caret";
import { validationMessage } from "@/translations/validation-message";
import { CHIP } from "./metadata-chips";

export type Slot = { name: string; description?: string };

// The target pane (§9.3): a draft, chips that insert the source's
// placeholders at the caret (no hand-typed braces), and the contract's
// validation as the draft changes. Save stays disabled while the draft
// is blank or invalid; the server re-validates regardless.
export function TargetPane({
  action,
  source,
  slots,
  language,
  initialText,
  slug,
  stringKey,
  openedVersion,
  queue,
}: {
  action: (formData: FormData) => void | Promise<void>;
  source: string;
  slots: Slot[];
  language: string;
  initialText: string;
  slug: string;
  stringKey: string;
  openedVersion: number;
  queue?: QueueKind;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === "";
  const validation = blank
    ? { ok: true as const }
    : validateTranslation(source, text);
  const errors = validation.ok ? [] : validation.errors;

  const insert = (name: string) => {
    const el = ref.current;
    const next = insertAtCaret(
      text,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
      `{${name}}`,
    );
    setText(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={stringKey} />
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="openedVersion" value={openedVersion} />
      {queue && <input type="hidden" name="queue" value={queue} />}
      <label className="block space-y-1.5">
        <span className="text-sm text-muted-foreground">
          {t("editor.targetLabel", { language })}
        </span>
        <textarea
          ref={ref}
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          autoCapitalize="sentences"
          className="w-full rounded-md border border-input bg-background p-3 text-lg leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </label>
      {slots.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("editor.placeholders")}
        >
          {slots.map((slot) => (
            <button
              key={slot.name}
              type="button"
              className={`${CHIP} min-h-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
              title={slot.description}
              onClick={() => insert(slot.name)}
            >
              {`{${slot.name}}`}
            </button>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-sm text-destructive">
          {errors.map((error, index) => (
            <li key={index}>{validationMessage(error)}</li>
          ))}
        </ul>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={blank || errors.length > 0}
        className="min-h-12 w-full text-base"
      >
        {t("editor.save")}
      </Button>
    </form>
  );
}
