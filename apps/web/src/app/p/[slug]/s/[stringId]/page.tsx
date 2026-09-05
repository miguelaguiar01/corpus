import { placeholdersOf } from "@corpus/contract";
import { notFound } from "next/navigation";
import { currentUser } from "@/auth/session";
import { isQueueKind, queueItems } from "@/catalogue/queues";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { HistoryList } from "@/components/history-list";
import { MetadataChips } from "@/components/metadata-chips";
import { Page } from "@/components/page-container";
import { Banner } from "@/components/ui/banner";
import { Section } from "@/components/ui/section";
import { QueueNav } from "@/components/queue-nav";
import { SourceView } from "@/components/source-view";
import { StateChips } from "@/components/state-chips";
import { TargetPane, type Slot } from "@/components/target-pane";
import { VerifyForm } from "@/components/verify-form";
import { getProjectBySlug } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { saveString, verifyString } from "@/translations/actions";
import { canVerifyRow } from "@/translations/permissions";
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
  const source = translations[project.sourceLanguage];
  // A target language selected in the URL turns the page into the editor
  // (§9.3): the source pane stays, the target pane appears. Queue links
  // select it for the untranslated and stale queues.
  const target =
    language !== project.sourceLanguage && project.languages.includes(language)
      ? language
      : undefined;
  const targetRow = target ? translations[target] : undefined;
  // Verify acts on the row being read: the target when one is selected,
  // otherwise the source (proofreading).
  const acted = targetRow ?? source;
  const actedLanguage = target ?? project.sourceLanguage;
  const canVerify =
    acted !== undefined &&
    canVerifyRow(user, { state: acted.state, archived: string.archived });
  // Chips are the source's own placeholders (select arguments are not
  // placeholders); declarations only supply descriptions.
  const described = new Map<string, string>();
  for (const decl of Object.values(declarations)) {
    if (decl.type !== "placeholders") continue;
    for (const [name, spec] of Object.entries(decl.slots)) {
      described.set(name, spec.description);
    }
  }
  const slots: Slot[] = [...placeholdersOf(string.source)].map((name) => ({
    name,
    description: described.get(name),
  }));
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "verify.errorGeneric")
    : undefined;

  const verify = canVerify && acted && (
    <VerifyForm
      action={verifyString}
      slug={slug}
      stringKey={string.key}
      openedVersion={acted.version}
      queue={queueKind}
      language={actedLanguage}
      inline
      secondary={target !== undefined}
    />
  );
  const proofreading = canVerify && !target && (
    <p className="text-xs text-muted-foreground">
      {t("editor.proofreading", { language: actedLanguage })}
    </p>
  );

  // Two panes from lg (§9.3): the source with its context left, the
  // target with its actions right, history full width below. Under lg
  // one column, with save and verify at thumb height in a fixed bar
  // and the page padded so the bar covers nothing.
  return (
    <Page width="wide" className="space-y-8 pb-32 lg:pb-8">
      {queue && (
        <div className="hidden lg:block">
          <QueueNav
            slug={slug}
            queue={queue}
            current={{ stringId: string.id, language }}
            inline
          />
        </div>
      )}
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-5">
          <header className="space-y-3">
            <p className="font-mono text-xs text-muted-foreground">
              {string.key}
            </p>
            <SourceView source={string.source} declarations={declarations} />
            {string.archived && (
              <Banner tone="info">{t("string.archived")}</Banner>
            )}
            {errorKey && <Banner tone="error">{t(errorKey)}</Banner>}
            {query.warning === "changed" && (
              <Banner tone="warning">{t("verify.warningChanged")}</Banner>
            )}
            <StateChips languages={project.languages} states={translations} />
            <MetadataChips
              declarations={declarations}
              metadata={string.metadata ?? {}}
            />
          </header>
          {entities.length > 0 && (
            <Section heading={t("string.entitiesHeading")}>
              <EntityCards entities={entities} />
            </Section>
          )}
          {examples.length > 0 && (
            <Section heading={t("string.examplesHeading")}>
              <ul className="space-y-2">
                {examples.map((example, index) => (
                  <li key={index} className="text-base leading-relaxed">
                    {example.rendered}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-6 lg:col-span-7">
          {target && targetRow && !string.archived && (
            <section className="space-y-3">
              {targetRow.stale && (
                <Banner tone="warning">{t("editor.staleBanner")}</Banner>
              )}
              <TargetPane
                action={saveString}
                source={string.source}
                slots={slots}
                language={target}
                initialText={targetRow.text ?? ""}
                slug={slug}
                stringKey={string.key}
                openedVersion={targetRow.version}
                queue={queueKind}
                examples={examples}
              />
            </section>
          )}
          {canVerify && (
            <div className="hidden space-y-2 lg:block">
              {proofreading}
              {verify}
            </div>
          )}
        </div>
      </div>

      <Section heading={t("string.historyHeading")}>
        <HistoryList history={history} />
      </Section>

      {(canVerify || queue) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-4 py-3 lg:hidden">
          <div className="mx-auto max-w-xl space-y-2">
            {canVerify && !target && (
              <p className="text-center text-xs text-muted-foreground">
                {t("editor.proofreading", { language: actedLanguage })}
              </p>
            )}
            {canVerify && acted && (
              <VerifyForm
                action={verifyString}
                slug={slug}
                stringKey={string.key}
                openedVersion={acted.version}
                queue={queueKind}
                language={actedLanguage}
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
    </Page>
  );
}
