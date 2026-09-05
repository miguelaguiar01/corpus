import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  rotateProjectToken,
  saveLanguages,
  toggleMaintainer,
} from "@/projects/actions";
import { getProjectBySlug } from "@/projects/service";
import { t, type MessageKey } from "@/i18n";

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
  const targets = project.languages.filter((l) => l !== project.sourceLanguage);
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "settings.errorInvalid")
    : undefined;

  return (
    <main className="mx-auto max-w-xl space-y-10">
      <h1 className="text-2xl font-semibold">{t("settings.heading")}</h1>

      {errorKey && (
        <p className="text-sm text-destructive" role="alert">
          {t(errorKey)}
        </p>
      )}
      {query.saved && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("settings.saved")}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">
          {t("settings.tokenHeading")}
        </h2>
        {query.token ? (
          <div className="space-y-2">
            <p className="text-sm">{t("settings.tokenOnce")}</p>
            <code className="block break-all rounded-md border border-border p-3 text-sm">
              {query.token}
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
      </section>

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">
          {t("settings.languagesHeading")}
        </h2>
        <form action={saveLanguages} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <p className="text-sm">
            {t("settings.sourceLanguage", { language: project.sourceLanguage })}
          </p>
          <label className="block space-y-1.5">
            <span className="text-sm">{t("settings.targetLanguages")}</span>
            <Input
              name="languages"
              defaultValue={targets.join(", ")}
              placeholder="en, pt-PT"
            />
          </label>
          <Button type="submit">{t("settings.saveLanguages")}</Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">
          {t("settings.usersHeading")}
        </h2>
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
      </section>
    </main>
  );
}
