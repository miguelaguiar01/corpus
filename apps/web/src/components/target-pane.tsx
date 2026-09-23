"use client";

import { useRef, useState } from "react";
import {
  branchingNodes,
  exampleValues,
  parseIcu,
  pluralCategoriesOf,
  renderPreviewSegments,
  isVoidTag,
  tagsOf,
  validateTranslation,
  type Example,
  type PreviewSegment,
  type Library,
} from "@corpus/contract";
import { chipText } from "@/components/source-view";
import { sourceStamp } from "@/translations/stamp";
import type { QueueKind } from "@/catalogue/queues";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { chipVariants } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { t } from "@/i18n";
import { insertAtCaret } from "@/translations/caret";
import { validationMessage } from "@/translations/validation-message";

export type Slot = {
  name: string;
  description?: string;
  format?: string;
  written?: string | null;
};

type Branching = { kind: "select" | "plural"; arg: string; keys: string[] };

// The source's select and plural arguments, each with every key any of
// its uses has, in source order (validation unions them the same way):
// a chip per argument inserts the whole skeleton so no braces are typed
// by hand. A plural's keys are the target language's categories, since
// those are what validation asks for, plus the source's exact =N ones.
function branchingOf(
  source: string,
  language: string,
  syntax: Library,
): Branching[] {
  const parsed = parseIcu(source, syntax);
  if (!parsed.ok) return [];
  const byArg = new Map<string, Branching>();
  for (const node of branchingNodes(parsed.nodes)) {
    const entry = byArg.get(node.arg) ?? {
      kind: node.kind,
      arg: node.arg,
      keys: node.kind === "plural" ? pluralCategoriesOf(language) : [],
    };
    for (const key of Object.keys(node.branches)) {
      if (entry.keys.includes(key)) continue;
      if (node.kind === "select") entry.keys.push(key);
      // Exact branches read first, before the categories, in source order.
      else if (key.startsWith("=")) {
        const exacts = entry.keys.filter((k) => k.startsWith("=")).length;
        entry.keys.splice(exacts, 0, key);
      }
    }
    if (entry.kind === "plural" && !entry.keys.includes("other"))
      entry.keys.push("other");
    byArg.set(node.arg, entry);
  }
  return [...byArg.values()];
}

// A plural's branches open with # so the count is there to keep.
function skeleton({ kind, arg, keys }: Branching) {
  const fill = kind === "plural" ? "#" : "";
  const head = `{${arg}, ${kind}, ${keys[0]} {${fill}`;
  const rest = keys
    .slice(1)
    .map((key) => ` ${key} {${fill}}`)
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
  syntax = "icu",
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
  syntax?: Library;
  slots: Slot[];
  language: string;
  initialText: string;
  slug: string;
  stringKey: string;
  openedVersion: number;
  queue?: QueueKind;
  examples?: Example[];
  // The examples' slot values are in the source language unless they
  // carry the target's (§7); the preview says which.
  sourceLanguage: string;
}) {
  const [text, setText] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === "";
  // One exporter, one set of languages: the first example decides which
  // language the previews and the chip hints are in. A blank draft shows
  // the examples' own source renders, so it stays in the source language.
  const resolved = examples.map((example) =>
    exampleValues(example, language, sourceLanguage),
  );
  const previewLanguage = blank
    ? sourceLanguage
    : (resolved[0]?.language ?? sourceLanguage);
  const hint = (slot: string) =>
    resolved[0]?.language === language ? resolved[0].values[slot] : undefined;
  const validation = blank
    ? { ok: true as const }
    : validateTranslation(source, text, language, syntax);
  const errors = validation.ok ? [] : validation.errors;
  // A plural missing a category its language uses saves with a warning
  // (#556); the chip for the category is still offered.
  const incomplete = validation.incomplete ?? [];
  const selects = branchingOf(source, language, syntax);
  const tags = [...tagsOf(source, syntax)];

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
      <input type="hidden" name="openedSource" value={sourceStamp(source)} />
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
              title={
                [slot.description, hint(slot.name)]
                  .filter(Boolean)
                  .join("\n") || undefined
              }
              onClick={() =>
                insert(chipText(slot.name, syntax, slot.format, slot.written))
              }
            >
              {chipText(slot.name, syntax, slot.format, slot.written)}
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
            const token = skeleton(select);
            return (
              <button
                key={select.arg}
                type="button"
                className={chipVariants({
                  variant: "key",
                  className:
                    "min-h-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                })}
                title={t(
                  select.kind === "plural"
                    ? "editor.insertPlural"
                    : "editor.insertSelect",
                  { arg: select.arg, keys: select.keys.join(", ") },
                )}
                onClick={() => insert(token.token, token.caret)}
              >
                {`{${select.arg}, ${select.kind}}`}
              </button>
            );
          })}
        </div>
      )}
      {tags.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={t("editor.tags")}
        >
          {tags.map((name) => {
            // The identity carries the attribute text; the close is the
            // bare name, and a void tag has no close (#590).
            const bare = name.split(/\s/)[0]!;
            const token = isVoidTag(bare)
              ? `<${name}/>`
              : `<${name}></${bare}>`;
            return (
              <button
                key={name}
                type="button"
                className={chipVariants({
                  variant: "key",
                  className:
                    "min-h-8 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                })}
                title={t("editor.insertTag", { name })}
                onClick={() =>
                  insert(token, isVoidTag(bare) ? undefined : name.length + 2)
                }
              >
                {`<${name}>`}
              </button>
            );
          })}
        </div>
      )}
      {examples.length > 0 && (
        <section
          role="region"
          aria-label={t("editor.previewHeading", {
            language: previewLanguage,
          })}
          className="space-y-1.5"
        >
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("editor.previewHeading", { language: previewLanguage })}
          </h3>
          <ul className="space-y-1.5">
            {previews(text, blank, examples, resolved, language, syntax).map(
              (segments, index) => (
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
              ),
            )}
          </ul>
        </section>
      )}
      {errors.length > 0 && (
        <Banner tone="error">
          <ul className="space-y-0.5">
            {errors.map((error, index) => (
              <li key={index}>{validationMessage(error, syntax)}</li>
            ))}
          </ul>
        </Banner>
      )}
      {incomplete.length > 0 && (
        <Banner tone="warning">
          <ul className="space-y-0.5">
            {incomplete.map((error, index) => (
              <li key={index}>{validationMessage(error, syntax)}</li>
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
  resolved: ReturnType<typeof exampleValues>[],
  language: string,
  syntax: Library,
): PreviewSegment[][] {
  return examples.flatMap((example, index) => {
    if (blank) return [[{ text: example.rendered, value: false }]];
    const result = renderPreviewSegments(
      text,
      resolved[index]!.values,
      language,
      { syntax },
    );
    return result.ok ? [result.segments] : [];
  });
}
