"use client";

import { useActionState } from "react";
import { createProjectAction, type NewProjectState } from "@/projects/actions";
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
        <p className="font-normal text-muted-foreground">
          {t("newProject.tokenOnce")}
        </p>
        <code className="block break-all rounded-md border border-border bg-background p-3 font-normal">
          {state.token}
        </code>
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
      <Field label={t("newProject.slug")}>
        <Input name="slug" required />
      </Field>
      <Field label={t("newProject.name")}>
        <Input name="name" required />
      </Field>
      <Field label={t("newProject.sourceLanguage")}>
        <Input name="sourceLanguage" required placeholder="en" />
      </Field>
      <Field label={t("newProject.languages")}>
        <Input name="languages" required placeholder="en, pt-PT" />
      </Field>
      <Button type="submit">{t("newProject.submit")}</Button>
    </form>
  );
}
