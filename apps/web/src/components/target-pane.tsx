"use client";

import { useRef, useState } from "react";
import {
  renderPreview,
  validateTranslation,
  type Example,
} from "@corpus/contract";
import type { QueueKind } from "@/catalogue/queues";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { t } from "@/i18n";
import { insertAtCaret } from "@/translations/caret";
import { validationMessage } from "@/translations/validation-message";

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
  examples = [],
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
  examples?: Example[];
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
      <Field label={t("editor.targetLabel", { language })}>
        <textarea
          ref={ref}
          name="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          autoCapitalize="sentences"
          className="w-full rounded-md border border-input bg-background p-3 text-lg leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Field>
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
              className={chipVariants({
                variant: "key",
                className:
                  "min-h-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              })}
              title={slot.description}
              onClick={() => insert(slot.name)}
            >
              {`{${slot.name}}`}
            </button>
          ))}
        </div>
      )}
      {examples.length > 0 && (
        <section
          role="region"
          aria-label={t("editor.previewHeading")}
          className="space-y-1.5"
        >
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("editor.previewHeading")}
          </h3>
          <ul className="space-y-1.5">
            {previews(text, blank, examples).map((preview, index) => (
              <li key={index} className="text-base leading-relaxed">
                {preview}
              </li>
            ))}
          </ul>
        </section>
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

// Live preview (§7): each example's values substituted into the draft,
// so both select branches show as the translator types. With no draft
// yet, the examples' own source-language renders stand in. A draft the
// parser rejects previews nothing; the validation list explains why.
function previews(text: string, blank: boolean, examples: Example[]): string[] {
  return examples.flatMap((example) => {
    if (blank) return [example.rendered];
    const result = renderPreview(text, example.values);
    return result.ok ? [result.text] : [];
  });
}
