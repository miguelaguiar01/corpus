import { notFound } from "next/navigation";
import { currentUser } from "@/auth/session";
import { isQueueKind, queueItems } from "@/catalogue/queues";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { HistoryList } from "@/components/history-list";
import { MetadataChips } from "@/components/metadata-chips";
import { QueueNav } from "@/components/queue-nav";
import { SourceView } from "@/components/source-view";
import { StateChips } from "@/components/state-chips";
import { VerifyForm } from "@/components/verify-form";
import { getProjectBySlug } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { verifyString } from "@/translations/actions";
import { t, type MessageKey } from "@/i18n";

type Query = {
  queue?: string;
  language?: string;
  error?: string;
  warning?: string;
};

const ERROR_KEY: Record<string, MessageKey> = {
  "not-maintainer": "verify.errorNotMaintainer",
  "invalid-translation": "editor.errorInvalid",
  "empty-text": "editor.errorEmpty",
  "source-row": "editor.errorSourceRow",
};

// Source verification surface (§9.3, M2): read the source with everything
// that gives it context, then sign it off and flow on through the queue.
// The full editor (target pane, branch view) is M3.
export default async function StringPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; stringId: string }>;
  searchParams: Promise<Query>;
}) {
  const { slug, stringId } = await params;
  const query = await searchParams;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const detail = stringDetail(db, project.id, decodeURIComponent(stringId));
  if (!detail) notFound();
  const user = await currentUser();
  const { string, declarations, translations, entities, history } = detail;
  const examples = string.examples ?? [];

  const queueKind = isQueueKind(query.queue) ? query.queue : undefined;
  const queue = queueKind ? queueItems(db, project.id, queueKind) : undefined;
  const language = query.language ?? project.sourceLanguage;
  // M2 is source proofreading: verify always acts on the source row, whatever
  // queue the reader arrived through. Target-row actions come with M3's editor.
  const source = translations[project.sourceLanguage];
  const canVerify =
    user?.maintainer === true &&
    source !== undefined &&
    source.state !== "verified" &&
    !string.archived;
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "verify.errorGeneric")
    : undefined;

  return (
    <main className="mx-auto max-w-xl space-y-8 pb-32">
      <header className="space-y-3">
        <p className="font-mono text-xs text-muted-foreground">{string.key}</p>
        <SourceView source={string.source} declarations={declarations} />
        {string.archived && (
          <p className="text-sm text-destructive">{t("string.archived")}</p>
        )}
        {errorKey && (
          <p className="text-sm text-destructive" role="alert">
            {t(errorKey)}
          </p>
        )}
        {query.warning === "changed" && (
          <p className="text-sm text-destructive" role="status">
            {t("verify.warningChanged")}
          </p>
        )}
        <StateChips languages={project.languages} states={translations} />
        <MetadataChips
          declarations={declarations}
          metadata={string.metadata ?? {}}
        />
      </header>

      {entities.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm text-muted-foreground">
            {t("string.entitiesHeading")}
          </h2>
          <EntityCards entities={entities} />
        </section>
      )}

      {examples.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm text-muted-foreground">
            {t("string.examplesHeading")}
          </h2>
          <ul className="space-y-2">
            {examples.map((example, index) => (
              <li key={index} className="text-base leading-relaxed">
                {example.rendered}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">
          {t("string.historyHeading")}
        </h2>
        <HistoryList history={history} />
      </section>

      {(canVerify || queue) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-4 py-3">
          <div className="mx-auto max-w-xl space-y-2">
            {canVerify && source && (
              <VerifyForm
                action={verifyString}
                slug={slug}
                stringKey={string.key}
                openedVersion={source.version}
                queue={queueKind}
                language={queueKind ? language : undefined}
              />
            )}
            {queue && (
              <QueueNav
                slug={slug}
                queue={queue}
                current={{ stringId: string.id, language }}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
