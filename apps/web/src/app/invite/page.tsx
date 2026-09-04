import { redirect } from "next/navigation";
import { submitInvite } from "@/auth/actions";
import {
  INVITE_ERROR_MESSAGES,
  MAX_NAME_LENGTH,
  type InviteErrorCode,
} from "@/auth/constants";
import { currentUser } from "@/auth/session";
import { Button } from "@/components/ui/button";
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
    <main className="flex min-h-dvh items-center justify-center px-6">
      <form action={submitInvite} className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t("invite.heading")}</h1>
          <p className="text-sm text-muted-foreground">{t("invite.intro")}</p>
        </div>
        {message !== undefined && (
          <p className="text-sm text-destructive" role="alert">
            {message}
          </p>
        )}
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("invite.nameLabel")}</span>
            <Input
              name="name"
              required
              maxLength={MAX_NAME_LENGTH}
              autoComplete="username"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              {t("invite.secretLabel")}
            </span>
            <Input
              name="secret"
              type="password"
              required
              autoComplete="current-password"
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
