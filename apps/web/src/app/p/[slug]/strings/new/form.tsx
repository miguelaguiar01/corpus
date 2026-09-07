"use client";

import { useActionState } from "react";
import type { WritableSource } from "@corpus/contract";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { t, type MessageKey } from "@/i18n";
import { proposeAddAction, type AddState } from "@/proposals/actions";

const ERROR_KEY: Record<string, MessageKey> = {
  exists: "proposal.addErrorExists",
  "invalid-key": "proposal.addErrorKey",
  "invalid-icu": "proposal.invalidIcu",
  "unknown-source": "proposal.addErrorSource",
};

const initial: AddState = { status: "idle" };

export function AddStringForm({
  slug,
  sources,
}: {
  slug: string;
  sources: WritableSource[];
}) {
  const [state, action] = useActionState(proposeAddAction, initial);
  const typed = state.status === "error" ? state : undefined;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {state.status === "error" && (
        <Banner tone="error">
          {t(ERROR_KEY[state.reason] ?? "proposal.errorGeneric")}
        </Banner>
      )}
      <Field label={t("proposal.addKey")} hint={t("proposal.addKeyHint")}>
        <input
          name="key"
          required
          defaultValue={typed?.key}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Field>
      <Field label={t("proposal.addSource")}>
        <select
          name="source"
          defaultValue={typed?.source}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {sources.map((source) => (
            <option key={source.path} value={source.path}>
              {t("proposal.addSourceOption", {
                path: source.path,
                type: source.type,
              })}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("proposal.addText")}>
        <textarea
          name="text"
          required
          defaultValue={typed?.text}
          rows={3}
          className="min-h-20 w-full resize-none rounded-md border border-input bg-background p-3 text-lg field-sizing-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Field>
      <Button type="submit">{t("proposal.addSubmit")}</Button>
    </form>
  );
}
