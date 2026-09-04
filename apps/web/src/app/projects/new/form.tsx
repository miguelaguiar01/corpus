"use client";

import { useActionState } from "react";
import { createProjectAction, type NewProjectState } from "@/projects/actions";
import { Button } from "@/components/ui/button";
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
      <div className="space-y-3" role="status">
        <p className="text-sm">
          {t("newProject.created", { slug: state.slug })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("newProject.tokenOnce")}
        </p>
        <code className="block break-all rounded-md bg-muted p-3 text-sm">
          {state.token}
        </code>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {t(ERROR_KEYS[state.reason] ?? "newProject.errorInvalid")}
        </p>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("newProject.slug")}</span>
        <Input name="slug" required />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("newProject.name")}</span>
        <Input name="name" required />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          {t("newProject.sourceLanguage")}
        </span>
        <Input name="sourceLanguage" required placeholder="en" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("newProject.languages")}</span>
        <Input name="languages" required placeholder="en, pt-PT" />
      </label>
      <Button type="submit">{t("newProject.submit")}</Button>
    </form>
  );
}
