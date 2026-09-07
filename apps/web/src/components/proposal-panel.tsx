"use client";

import { useRef, useState } from "react";
import { parseIcu } from "@corpus/contract";
import { Button } from "@/components/ui/button";
import { Chip, chipVariants } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { t, type MessageKey } from "@/i18n";
import { insertAtCaret } from "@/translations/caret";
import type { Slot } from "./target-pane";

export type PendingProposal = {
  id: number;
  kind: "edit" | "add" | "delete";
  text: string | null;
  author: string;
};

export type ProposalRecord = PendingProposal & {
  status: "pending" | "applied" | "superseded" | "withdrawn";
  at: Date;
};

const KIND_KEY: Record<PendingProposal["kind"], MessageKey> = {
  edit: "proposal.kindEdit",
  add: "proposal.kindAdd",
  delete: "proposal.kindDelete",
};

const STATUS_KEY: Record<ProposalRecord["status"], MessageKey> = {
  pending: "proposal.statusPending",
  applied: "proposal.statusApplied",
  superseded: "proposal.statusSuperseded",
  withdrawn: "proposal.statusWithdrawn",
};

function stamp(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

// Proposals on a string (§9.3, §11): propose a change to the source
// text or its removal, see the pending one, withdraw it, and read every
// outcome. Nothing here changes a translation or a state.
export function ProposalPanel({
  slug,
  stringKey,
  language,
  source,
  slots,
  writable,
  pending,
  history,
  actions,
}: {
  slug: string;
  stringKey: string;
  language?: string;
  source: string;
  slots: Slot[];
  writable: boolean;
  pending?: PendingProposal;
  history: ProposalRecord[];
  actions: {
    edit: (formData: FormData) => void | Promise<void>;
    remove: (formData: FormData) => void | Promise<void>;
    withdraw: (formData: FormData) => void | Promise<void>;
  };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(source);
  const ref = useRef<HTMLTextAreaElement>(null);
  const parsed = parseIcu(text);
  const valid = text.trim() !== "" && parsed.ok && text !== source;
  const insert = (token: string) => {
    const el = ref.current;
    const next = insertAtCaret(
      text,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
      token,
    );
    setText(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={stringKey} />
      {language && <input type="hidden" name="language" value={language} />}
    </>
  );

  return (
    <div className="space-y-3">
      {!writable ? (
        <p className="text-sm text-muted-foreground">
          {t("proposal.notWritable")}
        </p>
      ) : pending ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-baseline gap-2 text-sm">
            <Chip variant="state-stale">{t(KIND_KEY[pending.kind])}</Chip>
            <span className="text-muted-foreground">
              {t("proposal.by", { author: pending.author })}
            </span>
          </div>
          {pending.text !== null && (
            <p className="text-base leading-relaxed">{pending.text}</p>
          )}
          <form action={actions.withdraw}>
            {hidden}
            <input type="hidden" name="proposalId" value={pending.id} />
            <Button type="submit" variant="secondary" size="sm">
              {t("proposal.withdraw")}
            </Button>
          </form>
        </div>
      ) : open ? (
        <form action={actions.edit} className="space-y-3">
          {hidden}
          <Field label={t("proposal.editLabel")}>
            <textarea
              ref={ref}
              name="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              className="min-h-20 w-full resize-none rounded-md border border-input bg-background p-3 text-lg field-sizing-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                    className: "min-h-8 hover:bg-accent",
                  })}
                  title={slot.description}
                  onClick={() => insert(`{${slot.name}}`)}
                >
                  {`{${slot.name}}`}
                </button>
              ))}
            </div>
          )}
          {!parsed.ok && text.trim() !== "" && (
            <p className="text-sm text-destructive">
              {t("proposal.invalidIcu")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!valid}>
              {t("proposal.submitEdit")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              {t("proposal.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(true)}
          >
            {t("proposal.propose")}
          </Button>
          <form action={actions.remove}>
            {hidden}
            <Button type="submit" variant="secondary">
              {t("proposal.proposeRemoval")}
            </Button>
          </form>
        </div>
      )}
      {history.length > 0 && (
        <ol className="divide-y divide-border text-sm">
          {history.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-2 py-1.5"
            >
              <span className="font-medium">{entry.author}</span>
              <span className="text-muted-foreground">
                {t(KIND_KEY[entry.kind])}
              </span>
              <span className="text-muted-foreground">
                {t(STATUS_KEY[entry.status])}
              </span>
              <span className="text-muted-foreground">{stamp(entry.at)}</span>
              {entry.text !== null && (
                <span className="basis-full">{entry.text}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
