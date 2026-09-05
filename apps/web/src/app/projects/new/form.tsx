"use client";

import { useActionState } from "react";
import { createProjectAction, type NewProjectState } from "@/projects/actions";
import { CopyButton } from "@/components/copy-button";
import { LanguagesInput } from "@/components/languages-input";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t, type MessageKey } from "@/i18n";

const ERROR_KEYS: Record<string, MessageKey> = {
  "slug-taken": "newProject.errorSlugTaken",
  forbidden: "newProject.errorForbidden",
  invalid: "newProject.errorInvalid",
};

const initial: NewProjectState = { status: "idle" };

export function NewProjectForm() {
  const [state, action] = useActionState(createProjectAction, initial);

  if (state.status === "created") {
    return (
      <Banner tone="success" className="space-y-3">
        <p>{t("newProject.created", { slug: state.slug })}</p>
        <p className="text-muted-foreground">{t("newProject.tokenOnce")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="block break-all rounded-md border border-border bg-background px-3 py-2 font-mono">
            {state.token}
          </code>
          <CopyButton value={state.token} />
        </div>
      </Banner>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && (
        <Banner tone="error">
          {t(ERROR_KEYS[state.reason] ?? "newProject.errorInvalid")}
        </Banner>
      )}
      <Field label={t("newProject.slug")} hint={t("newProject.slugHint")}>
        <Input name="slug" required autoCapitalize="none" />
      </Field>
      <Field label={t("newProject.name")} hint={t("newProject.nameHint")}>
        <Input name="name" required />
      </Field>
      <Field
        label={t("newProject.sourceLanguage")}
        hint={t("newProject.sourceLanguageHint")}
      >
        <Input
          name="sourceLanguage"
          required
          placeholder="en"
          autoCapitalize="none"
        />
      </Field>
      <LanguagesInput
        label={t("newProject.languages")}
        hint={t("newProject.languagesHint")}
      />
      <Button type="submit">{t("newProject.submit")}</Button>
    </form>
  );
}
