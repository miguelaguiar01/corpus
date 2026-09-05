"use client";

import { useRef, useState } from "react";
import {
  parseIcu,
  renderPreviewSegments,
  validateTranslation,
  type Example,
  type PreviewSegment,
} from "@corpus/contract";
import type { QueueKind } from "@/catalogue/queues";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { t } from "@/i18n";
import { insertAtCaret } from "@/translations/caret";
import { validationMessage } from "@/translations/validation-message";

export type Slot = { name: string; description?: string };

// The source's select arguments, each with every key any of its selects
// uses, in source order (validation unions them the same way): a chip
// per argument inserts the whole skeleton so no braces are typed by hand.
function selectsOf(source: string): { arg: string; keys: string[] }[] {
  const parsed = parseIcu(source);
  if (!parsed.ok) return [];
  const byArg = new Map<string, Set<string>>();
  for (const node of parsed.nodes) {
    if (node.kind !== "select") continue;
    const keys = byArg.get(node.arg) ?? new Set<string>();
    for (const key of Object.keys(node.branches)) keys.add(key);
    byArg.set(node.arg, keys);
  }
  return [...byArg].map(([arg, keys]) => ({ arg, keys: [...keys] }));
}

function selectSkeleton(arg: string, keys: string[]) {
  const head = `{${arg}, select, ${keys[0]} {`;
  const rest = keys
    .slice(1)
    .map((key) => ` ${key} {}`)
    .join("");
  return { token: `${head}}${rest}}`, caret: head.length };
}

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
  sourceLanguage,
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
  // The examples' slot values are in the source language (§7); the
  // preview says so.
  sourceLanguage: string;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === "";
  const validation = blank
    ? { ok: true as const }
    : validateTranslation(source, text);
  const errors = validation.ok ? [] : validation.errors;
  const selects = selectsOf(source);

  const insert = (token: string, caretOffset?: number) => {
    const el = ref.current;
    const next = insertAtCaret(
      text,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
      token,
      caretOffset,
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
          className="min-h-28 w-full resize-none rounded-md border border-input bg-background p-3 text-lg field-sizing-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
              onClick={() => insert(`{${slot.name}}`)}
            >
              {`{${slot.name}}`}
            </button>
          ))}
        </div>
      )}
      {selects.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("editor.selects")}
        >
          {selects.map((select) => {
            const skeleton = selectSkeleton(select.arg, select.keys);
            return (
              <button
                key={select.arg}
                type="button"
                className={chipVariants({
                  variant: "key",
                  className:
                    "min-h-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                })}
                title={t("editor.insertSelect", {
                  arg: select.arg,
                  keys: select.keys.join(", "),
                })}
                onClick={() => insert(skeleton.token, skeleton.caret)}
              >
                {`{${select.arg}, select}`}
              </button>
            );
          })}
        </div>
      )}
      {examples.length > 0 && (
        <section
          role="region"
          aria-label={t("editor.previewHeading", { language: sourceLanguage })}
          className="space-y-1.5"
        >
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("editor.previewHeading", { language: sourceLanguage })}
          </h3>
          <ul className="space-y-1.5">
            {previews(text, blank, examples).map((segments, index) => (
              <li key={index} className="text-base leading-relaxed">
                {segments.map((segment, i) =>
                  segment.value ? (
                    <span key={i} className="text-muted-foreground">
                      {segment.text}
                    </span>
                  ) : (
                    <span key={i}>{segment.text}</span>
                  ),
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {errors.length > 0 && (
        <Banner tone="error">
          <ul className="space-y-0.5">
            {errors.map((error, index) => (
              <li key={index}>{validationMessage(error)}</li>
            ))}
          </ul>
        </Banner>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={blank || errors.length > 0}
        className="min-h-12 w-full text-base lg:min-h-0 lg:w-auto lg:text-sm"
      >
        {t("editor.save")}
      </Button>
    </form>
  );
}

// Live preview (§7): each example's values substituted into the draft,
// so both select branches show as the translator types, the values in
// the quiet tone so the translator's own words stand out. With no draft
// yet, the examples' own source-language renders stand in. A draft the
// parser rejects previews nothing; the validation list explains why.
function previews(
  text: string,
  blank: boolean,
  examples: Example[],
): PreviewSegment[][] {
  return examples.flatMap((example) => {
    if (blank) return [[{ text: example.rendered, value: false }]];
    const result = renderPreviewSegments(text, example.values);
    return result.ok ? [result.segments] : [];
  });
}
