import { placeholdersOf } from "@corpus/contract";
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
import { TargetPane, type Slot } from "@/components/target-pane";
import { VerifyForm } from "@/components/verify-form";
import { getProjectBySlug } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { saveString, verifyString } from "@/translations/actions";
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
  // A target language selected in the URL turns the page into the editor
  // (§9.3): the source pane stays, the target pane appears. Queue links
  // will select it (#109); until then it is reachable by URL.
  const target =
    language !== project.sourceLanguage && project.languages.includes(language)
      ? language
      : undefined;
  const targetRow = target ? translations[target] : undefined;
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

      {target && targetRow && !string.archived && (
        <section className="space-y-3">
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
