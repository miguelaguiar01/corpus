import { redirect } from "next/navigation";
import { submitPassword } from "@/auth/actions";
import { INVITE_PATH } from "@/auth/constants";
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

// Where a reset lands: the temporary password has signed the person in,
// and requireUser sends them here until they choose their own.
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect(INVITE_PATH);
  const { error } = await searchParams;

  return (
    <AppShell home={false} signedIn>
      <Page width="form" className="space-y-6 py-12 lg:py-20">
        <PageHeader
          title={t("password.heading")}
          meta={t(
            user.passwordTemporary ? "password.introReset" : "password.intro",
          )}
        />
        <form action={submitPassword} className="space-y-6">
          {error !== undefined && (
            <Banner tone="error">{t("invite.errorWeakPassword")}</Banner>
          )}
          <Field
            label={t("password.newLabel")}
            hint={t("invite.passwordHint", { min: MIN_PASSWORD_LENGTH })}
          >
            <Input
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
            />
          </Field>
          <Button type="submit" className="w-full">
            {t("password.submit")}
          </Button>
        </form>
      </Page>
    </AppShell>
  );
}
