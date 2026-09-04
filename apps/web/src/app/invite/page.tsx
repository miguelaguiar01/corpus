import { submitInvite } from "@/auth/actions";
import { currentUser } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { redirect } from "next/navigation";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form action={submitInvite} className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t("invite.heading")}</h1>
          <p className="text-sm text-muted-foreground">{t("invite.intro")}</p>
        </div>
        {error !== undefined && (
          <p className="text-sm text-destructive" role="alert">
            {error === "rate-limited"
              ? t("invite.errorRateLimited")
              : t("invite.errorInvalid")}
          </p>
        )}
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("invite.nameLabel")}</span>
            <input
              name="name"
              required
              maxLength={80}
              autoComplete="username"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              {t("invite.secretLabel")}
            </span>
            <input
              name="secret"
              type="password"
              required
              autoComplete="current-password"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>
        </div>
        <Button type="submit" className="w-full">
          {t("invite.submit")}
        </Button>
      </form>
    </main>
  );
}
