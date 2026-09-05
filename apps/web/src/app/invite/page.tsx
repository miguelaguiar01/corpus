import { redirect } from "next/navigation";
import { submitInvite } from "@/auth/actions";
import {
  INVITE_ERROR_MESSAGES,
  MAX_NAME_LENGTH,
  type InviteErrorCode,
} from "@/auth/constants";
import { currentUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

function errorMessage(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const key =
    INVITE_ERROR_MESSAGES[code as InviteErrorCode] ??
    INVITE_ERROR_MESSAGES.invalid;
  return t(key);
}

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <AppShell home={false}>
      <Page width="form" className="space-y-6 py-12 lg:py-20">
        <PageHeader title={t("invite.heading")} meta={t("app.tagline")} />
        <p className="text-sm text-muted-foreground">{t("invite.intro")}</p>
        <form action={submitInvite} className="space-y-6">
          {message !== undefined && <Banner tone="error">{message}</Banner>}
          <div className="space-y-4">
            <Field label={t("invite.nameLabel")}>
              <Input
                name="name"
                required
                maxLength={MAX_NAME_LENGTH}
                autoComplete="username"
              />
            </Field>
            <Field label={t("invite.secretLabel")}>
              <Input
                name="secret"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
          </div>
          <Button type="submit" className="w-full">
            {t("invite.submit")}
          </Button>
        </form>
      </Page>
    </AppShell>
  );
}
