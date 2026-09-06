import { redirect } from "next/navigation";
import { submitJoin, submitSignIn } from "@/auth/actions";
import {
  INVITE_ERROR_MESSAGES,
  MAX_NAME_LENGTH,
  type InviteErrorCode,
} from "@/auth/constants";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/auth/password";
import { currentUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

function errorMessage(
  code: string | undefined,
  wait: string | undefined,
): string | undefined {
  if (code === undefined) return undefined;
  const key =
    INVITE_ERROR_MESSAGES[code as InviteErrorCode] ??
    INVITE_ERROR_MESSAGES.invalid;
  const minutes = Math.max(1, Math.floor(Number(wait)) || 1);
  return t(key, { minutes });
}

// Which form the error belongs under, so it sits beside the fields the
// visitor has to fix; a rate limit covers both and sits above them.
const JOIN_ERRORS: ReadonlySet<string> = new Set([
  "invalid",
  "name-taken",
  "weak-password",
]);

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; wait?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const { error, wait } = await searchParams;
  const message = errorMessage(error, wait);
  const joinError = error !== undefined && JOIN_ERRORS.has(error);
  const pageError = error === "rate-limited";
  const passwordLimits = {
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH,
  };

  return (
    <AppShell home={false}>
      <Page width="form" className="space-y-12 py-12 lg:py-20">
        {message !== undefined && pageError && (
          <Banner tone="error">{message}</Banner>
        )}
        <div className="space-y-6">
          <PageHeader
            title={t("invite.signInHeading")}
            meta={t("app.tagline")}
          />
          <form action={submitSignIn} className="space-y-6">
            {message !== undefined && !joinError && !pageError && (
              <Banner tone="error">{message}</Banner>
            )}
            <div className="space-y-4">
              <Field label={t("invite.nameLabel")}>
                <Input
                  name="name"
                  required
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="username"
                />
              </Field>
              <Field label={t("invite.passwordLabel")}>
                <Input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
            </div>
            <Button type="submit" className="w-full">
              {t("invite.signIn")}
            </Button>
          </form>
        </div>
        <div className="space-y-6 border-t border-border pt-10">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t("invite.heading")}</h2>
            <p className="text-sm text-muted-foreground">{t("invite.intro")}</p>
          </div>
          <form action={submitJoin} className="space-y-6">
            {message !== undefined && joinError && (
              <Banner tone="error">{message}</Banner>
            )}
            <div className="space-y-4">
              <Field label={t("invite.secretLabel")}>
                <Input
                  name="secret"
                  type="password"
                  required
                  autoComplete="off"
                />
              </Field>
              <Field label={t("invite.joinNameLabel")}>
                <Input
                  name="name"
                  required
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="username"
                />
              </Field>
              <Field
                label={t("invite.choosePasswordLabel")}
                hint={t("invite.passwordHint", { min: MIN_PASSWORD_LENGTH })}
              >
                <Input
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  {...passwordLimits}
                />
              </Field>
            </div>
            <Button type="submit" variant="outline" className="w-full">
              {t("invite.submit")}
            </Button>
          </form>
        </div>
      </Page>
    </AppShell>
  );
}
