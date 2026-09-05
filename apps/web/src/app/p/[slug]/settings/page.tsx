import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  rotateProjectToken,
  saveLanguages,
  resetPasswordAction,
  toggleMaintainer,
} from "@/projects/actions";
import { NEW_TOKEN_COOKIE, RESET_PASSWORD_COOKIE } from "@/projects/constants";
import { getProjectBySlug } from "@/projects/service";
import { pushHistory } from "@/pushes/history";
import { t, type MessageKey } from "@/i18n";
import { appVersion } from "@/version";

type Query = {
  token?: string;
  reset?: string;
  saved?: string;
  error?: string;
};

const ERROR_KEY: Record<string, MessageKey> = {
  forbidden: "settings.errorForbidden",
  invalid: "settings.errorInvalid",
  "last-maintainer": "settings.errorLastMaintainer",
};

// Maintainer corner (§9.5): maintainers only; everyone else gets a 404
// so the surface does not even exist for them.
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const user = await requireUser();
  if (!user.maintainer) notFound();
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const people = db.select().from(users).orderBy(users.name).all();
  const history = pushHistory(db, project.id);
  const targets = project.languages.filter((l) => l !== project.sourceLanguage);
  // The freshly rotated token, if the action just set it (60 s cookie).
  const newToken =
    query.token === "1"
      ? (await cookies()).get(NEW_TOKEN_COOKIE)?.value
      : undefined;
  // Likewise the temporary password a reset just issued, tied to the
  // person it was issued for so a stale cookie cannot be shown for another.
  const resetCookie = query.reset
    ? (await cookies()).get(RESET_PASSWORD_COOKIE)?.value
    : undefined;
  const resetFor = people.find((p) => String(p.id) === query.reset);
  const temporaryPassword =
    resetCookie && resetFor && resetCookie.startsWith(`${resetFor.id}:`)
      ? resetCookie.slice(`${resetFor.id}:`.length)
      : undefined;
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "settings.errorInvalid")
    : undefined;

  return (
    <Page width="reading">
      <PageHeader
        title={t("settings.heading")}
        meta={t("settings.version", { version: appVersion(process.env) })}
      />
      {(errorKey || query.saved) && (
        <div className="mt-6 space-y-4">
          {errorKey && <Banner tone="error">{t(errorKey)}</Banner>}
          {query.saved && <Banner tone="success">{t("settings.saved")}</Banner>}
        </div>
      )}

      <div className="divide-y divide-border">
        <Section
          heading={t("settings.tokenHeading")}
          description={t("settings.tokenIntro")}
          className="py-8"
        >
          {newToken && (
            <Banner tone="success" className="space-y-2">
              <p>{t("settings.tokenOnce")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="block break-all rounded-md border border-border bg-background px-3 py-2 font-mono">
                  {newToken}
                </code>
                <CopyButton value={newToken} />
              </div>
            </Banner>
          )}
          <form action={rotateProjectToken}>
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" variant="outline">
              {t("settings.rotateToken")}
            </Button>
          </form>
        </Section>

        <Section
          heading={t("settings.languagesHeading")}
          description={t("settings.languagesIntro", {
            language: project.sourceLanguage,
          })}
          className="py-8"
        >
          <form action={saveLanguages} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <Field
              label={t("settings.targetLanguages")}
              hint={t("settings.targetLanguagesHint")}
            >
              <Input
                name="languages"
                defaultValue={targets.join(", ")}
                placeholder="en, pt-PT"
              />
            </Field>
            <Button type="submit">{t("settings.saveLanguages")}</Button>
          </form>
        </Section>

        <Section
          heading={t("settings.historyHeading")}
          description={t("settings.historyIntro")}
          className="py-8"
        >
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.historyEmpty")}
            </p>
          ) : (
            <ol className="divide-y divide-border text-sm">
              {history.map((push) => (
                <li key={push.id} className="space-y-0.5 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <time dateTime={push.at.toISOString()}>
                      {push.at.toISOString().slice(0, 16).replace("T", " ")}
                    </time>
                    <span className="text-muted-foreground">
                      {t("settings.historyStrings", {
                        count: push.stringCount,
                      })}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {t("settings.historyReport", {
                      added: push.added,
                      changed: push.changed,
                      stale: push.stale,
                      archived: push.archived,
                      seeded: push.seeded,
                    })}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section
          heading={t("settings.usersHeading")}
          description={t("settings.usersIntro")}
          className="py-8"
        >
          {temporaryPassword && resetFor && (
            <Banner tone="success" className="space-y-2">
              <p>{t("settings.resetDone", { name: resetFor.name })}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="block rounded-md border border-border bg-background px-3 py-2 font-mono">
                  {temporaryPassword}
                </code>
                <CopyButton value={temporaryPassword} />
              </div>
            </Banner>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    {t("settings.colName")}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t("settings.colRole")}
                  </th>
                  <th scope="col" className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => (
                  <tr key={person.id}>
                    <td className="max-w-48 truncate py-2 pr-3">
                      {person.name}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {person.maintainer
                        ? t("settings.roleMaintainer")
                        : t("settings.roleTranslator")}
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <form action={resetPasswordAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input
                            type="hidden"
                            name="userId"
                            value={person.id}
                          />
                          <Button type="submit" variant="ghost" size="sm">
                            {t("settings.resetPassword")}
                          </Button>
                        </form>
                        <form action={toggleMaintainer}>
                          <input type="hidden" name="slug" value={slug} />
                          <input
                            type="hidden"
                            name="userId"
                            value={person.id}
                          />
                          <input
                            type="hidden"
                            name="maintainer"
                            value={person.maintainer ? "0" : "1"}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            {person.maintainer
                              ? t("settings.demote")
                              : t("settings.promote")}
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </Page>
  );
}
