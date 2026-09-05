import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  rotateProjectToken,
  saveLanguages,
  toggleMaintainer,
} from "@/projects/actions";
import { NEW_TOKEN_COOKIE } from "@/projects/constants";
import { getProjectBySlug } from "@/projects/service";
import { pushHistory } from "@/pushes/history";
import { t, type MessageKey } from "@/i18n";
import { appVersion } from "@/version";

type Query = { token?: string; saved?: string; error?: string };

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
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "settings.errorInvalid")
    : undefined;

  return (
    <Page width="reading" className="space-y-10">
      <PageHeader
        title={t("settings.heading")}
        meta={t("settings.version", { version: appVersion(process.env) })}
      />

      {errorKey && <Banner tone="error">{t(errorKey)}</Banner>}
      {query.saved && <Banner tone="success">{t("settings.saved")}</Banner>}

      <Section heading={t("settings.tokenHeading")}>
        {newToken ? (
          <div className="space-y-2">
            <p className="text-sm">{t("settings.tokenOnce")}</p>
            <code className="block break-all rounded-md border border-border p-3 text-sm">
              {newToken}
            </code>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settings.tokenIntro")}
          </p>
        )}
        <form action={rotateProjectToken}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="outline">
            {t("settings.rotateToken")}
          </Button>
        </form>
      </Section>

      <Section heading={t("settings.languagesHeading")}>
        <form action={saveLanguages} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <p className="text-sm">
            {t("settings.sourceLanguage", { language: project.sourceLanguage })}
          </p>
          <Field label={t("settings.targetLanguages")}>
            <Input
              name="languages"
              defaultValue={targets.join(", ")}
              placeholder="en, pt-PT"
            />
          </Field>
          <Button type="submit">{t("settings.saveLanguages")}</Button>
        </form>
      </Section>

      <Section heading={t("settings.historyHeading")}>
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
                    {t("settings.historyStrings", { count: push.stringCount })}
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

      <Section heading={t("settings.usersHeading")}>
        <ul className="divide-y divide-border border-y border-border">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex min-h-12 items-center gap-3 py-2"
            >
              <span className="flex-1">{person.name}</span>
              <span className="text-xs text-muted-foreground">
                {person.maintainer
                  ? t("settings.roleMaintainer")
                  : t("settings.roleTranslator")}
              </span>
              <form action={toggleMaintainer}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="userId" value={person.id} />
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
            </li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}
