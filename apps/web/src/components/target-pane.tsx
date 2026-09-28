"use client";

import { useRef, useState } from "react";
import {
  branchingNodes,
  exampleValues,
  readIcu,
  pluralCategoriesOf,
  renderPreviewSegments,
  hasVoidTags,
  isVoidTag,
  tagsOf,
  validateTranslation,
  type Example,
  type PreviewSegment,
  type Library,
  type RichText,
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

type Branching = {
  kind: "select" | "plural";
  arg: string;
  keys: string[];
  // The arguments nested in each key's branch (#765), by `idOf`.
  inner: Map<string, string[]>;
};

// A select and a plural may share an argument's name; each is its own
// chip (#770).
const idOf = (node: { kind: "select" | "plural"; arg: string }) =>
  `${node.kind} ${node.arg}`;

// The source's select and plural arguments, each with every key any of
// its uses has, in source order (validation unions them the same way):
// a chip per argument and kind inserts the whole skeleton so no braces
// are typed
// by hand. A plural's keys are the target language's categories, since
// those are what validation asks for, plus the source's exact =N ones.
// A nested argument has a chip of its own, and its skeleton sits in
// each branch of its outer one's.
function branchingOf(
  source: string,
  language: string,
  syntax: Library,
): Branching[] {
  const parsed = readIcu(source, syntax);
  if (!parsed.ok) return [];
  const byId = new Map<string, Branching>();
  const sourced = new Map<string, Set<string>>();
  for (const node of branchingNodes(parsed.nodes)) {
    const keys = sourced.get(idOf(node)) ?? new Set<string>();
    for (const key of Object.keys(node.branches)) keys.add(key);
    sourced.set(idOf(node), keys);
    const entry = byId.get(idOf(node)) ?? {
      kind: node.kind,
      arg: node.arg,
      keys: node.kind === "plural" ? pluralCategoriesOf(language) : [],
      inner: new Map<string, string[]>(),
    };
    for (const [key, branch] of Object.entries(node.branches)) {
      for (const nested of branchingNodes(branch, false)) {
        const args = entry.inner.get(key) ?? [];
        if (!args.includes(idOf(nested))) args.push(idOf(nested));
        entry.inner.set(key, args);
      }
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
    byId.set(idOf(node), entry);
  }
  // A plural's categories are the target language's: a category the
  // source lacks holds what the source's `other` does.
  for (const entry of byId.values()) {
    const other = entry.inner.get("other");
    if (entry.kind !== "plural" || !other) continue;
    for (const key of entry.keys)
      if (!key.startsWith("=") && !sourced.get(idOf(entry))?.has(key))
        entry.inner.set(key, other);
  }
  return [...byId.values()];
}

// A plural's branches open with the count so it is there to keep: `#`
// where ICU reads it, the placeholder under i18next, and nothing under
// printf and android, whose verb the source names (#662, #689).
// A branch holding a nested argument holds its skeleton in place of
// the count, which that argument's own branches carry (#765). Nesting
// is one level deep, so an inner skeleton is never expanded further:
// arguments nested in each other in different places would not end.
function skeleton(
  { kind, arg, keys, inner }: Branching,
  syntax: Library,
  byId?: Map<string, Branching>,
): { token: string; caret: number } {
  const own =
    kind !== "plural"
      ? ""
      : syntax === "i18next"
        ? `{{${arg}}}`
        : syntax === "counterpart"
          ? `%(${arg})s`
          : syntax === "easy_localization"
            ? "{}"
            : syntax === "rails"
              ? `%{${arg}}`
              : syntax === "qt"
                ? "%n"
                : syntax === "printf" || syntax === "android"
                  ? ""
                  : "#";
  const fill = (key: string) => {
    const nested = (byId ? (inner.get(key) ?? []) : []).flatMap((name) => {
      const entry = byId?.get(name);
      return entry ? [skeleton(entry, syntax)] : [];
    });
    if (nested.length === 0) return { text: own, caret: own.length };
    return {
      text: nested.map((n) => n.token).join(" "),
      caret: nested[0]!.caret,
    };
  };
  const first = fill(keys[0]!);
  const head = `{${arg}, ${kind}, ${keys[0]} {`;
  const rest = keys
    .slice(1)
    .map((key) => ` ${key} {${fill(key).text}}`)
    .join("");
  return {
    token: `${head}${first.text}}${rest}}`,
    caret: head.length + first.caret,
  };
}

// The target pane (§9.3): a draft, chips that insert the source's
// placeholders at the caret (no hand-typed braces), and the contract's
// validation as the draft changes. Save stays disabled while the draft
// is blank or invalid; the server re-validates regardless.
export function TargetPane({
  action,
  source,
  syntax = "icu",
  richText = null,
  passed,
  slots,
  language,
  initialText,
  slug,
  stringKey,
  openedVersion,
  queue,
  examples = [],
  sourceLanguage,
  suggestion = null,
}: {
  action: (formData: FormData) => void | Promise<void>;
  source: string;
  syntax?: Library;
  richText?: RichText | null;
  // The verbs the code passes where the key carries them (#731).
  passed?: string[] | null;
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
  // The repository's guess to start from (#774): shown, never saved
  // until the translator saves.
  suggestion?: string | null;
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
    : validateTranslation(source, text, language, syntax, {
        richText: richText ?? undefined,
        ...(passed && { arguments: passed }),
      });
  const errors = validation.ok ? [] : validation.errors;
  // A plural missing a category its language uses saves with a warning
  // (#556); the chip for the category is still offered.
  const incomplete = validation.incomplete ?? [];
  const selects = branchingOf(source, language, syntax);
  const byId = new Map(selects.map((entry) => [idOf(entry), entry]));
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
      {suggestion && (
        <div
          role="region"
          aria-label={t("editor.suggestionLabel")}
          className="space-y-2 rounded-md border border-dashed border-input p-3"
        >
          <p className="text-sm text-muted-foreground">
            {t("editor.suggestionLabel")}
          </p>
          <p className="text-base whitespace-pre-line">{suggestion}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setText(suggestion)}
          >
            {t("editor.useSuggestion")}
          </Button>
        </div>
      )}
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
            const token = skeleton(select, syntax, byId);
            return (
              <button
                key={idOf(select)}
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
            // bare name, and a void tag has none where the text is HTML
            // (#590, #643).
            const bare = name.split(/\s/)[0]!;
            const voided =
              isVoidTag(bare) && hasVoidTags(syntax, richText ?? undefined);
            const token = voided ? `<${name}/>` : `<${name}></${bare}>`;
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
                  insert(token, voided ? undefined : name.length + 2)
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
// yet, the examples' own source-language renders stand in. A draft is
// read as a preview reads any text (#755), an unclosed tag as text; one
// no reading parses previews nothing, and the validation list explains
// what is wrong either way.
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
