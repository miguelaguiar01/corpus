import { isHtml, partsOf } from "@corpus/contract";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { isQueueKind, queueStep } from "@/catalogue/queues";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { HistoryList } from "@/components/history-list";
import { MetadataChips } from "@/components/metadata-chips";
import { Page } from "@/components/page-container";
import { Banner } from "@/components/ui/banner";
import { Section } from "@/components/ui/section";
import { QueueNav } from "@/components/queue-nav";
import { SourceView } from "@/components/source-view";
import { OtherLanguages } from "@/components/other-languages";
import { GlossaryTerms } from "@/components/glossary-terms";
import { Siblings } from "@/components/siblings";
import { NoteText } from "@/components/note-text";
import { suggestionOf } from "@/translations/suggestion";
import { siblingsOf } from "@/strings/siblings";
import { takenLanguages } from "@/strings/languages";
import { inPositionOrder } from "@/strings/slots";
import { ProposalPanel } from "@/components/proposal-panel";
import { LanguageBar } from "@/components/language-bar";
import { StateChips } from "@/components/state-chips";
import { keyFromSegment, languageSwitchPath } from "@/strings/paths";
import { TargetPane, type Slot } from "@/components/target-pane";
import { carriedFrom } from "@/translations/carried";
import { VerifyForm } from "@/components/verify-form";
import { getProjectBySlug } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { saveString, verifyString } from "@/translations/actions";
import {
  proposeDeleteAction,
  proposeEditAction,
  withdrawProposalAction,
} from "@/proposals/actions";
import { pendingForString, proposalsForKey } from "@/proposals/service";
import { canVerifyRow } from "@/translations/permissions";
import { t, type MessageKey } from "@/i18n";

type Query = {
  proposed?: string;
  withdrawn?: string;
  proposalError?: string;
  queue?: string;
  language?: string;
  error?: string;
  warning?: string;
  // A draft a refused save carried back (#529), and the version it was
  // opened at (#1058).
  draft?: string;
  opened?: string;
};

const PROPOSAL_ERROR_KEY: Record<string, MessageKey> = {
  unchanged: "proposal.errorUnchanged",
  forbidden: "proposal.errorForbidden",
  "not-pending": "proposal.errorNotPending",
  "invalid-icu": "proposal.invalidIcu",
  // Reachable from a page rendered before a push marked the string (#611).
  "key-is-text": "proposal.keyIsText",
  generated: "proposal.generatedError",
};

const ERROR_KEY: Record<string, MessageKey> = {
  "not-maintainer": "verify.errorNotMaintainer",
  "invalid-translation": "editor.errorInvalid",
  "empty-text": "editor.errorEmpty",
  "source-row": "editor.errorSourceRow",
};

// The string surface (§9.3): read the source with everything that gives
// it context, translate it or sign it off, and flow on through the queue.
export default async function StringPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; stringId: string }>;
  searchParams: Promise<Query>;
}) {
  const user = await requireUser();
  const { slug, stringId } = await params;
  const query = await searchParams;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const key = keyFromSegment(stringId);
  if (key === null) notFound();
  const detail = stringDetail(db, project.id, key);
  if (!detail) notFound();
  const { string, declarations, translations, entities, history } = detail;
  const siblings = siblingsOf(db, project.id, {
    id: string.id,
    key: string.key,
    type: string.type,
    sourceLanguage: project.sourceLanguage,
  });
  const examples = string.examples ?? [];

  const queueKind = isQueueKind(query.queue) ? query.queue : undefined;
  const pendingProposal = pendingForString(db, string.id);
  const proposalHistory = proposalsForKey(db, project.id, string.key).map(
    (p) => ({
      id: p.id,
      kind: p.kind,
      text: p.text,
      author: p.author,
      authorId: p.authorId,
      status: p.status,
      at: p.createdAt,
    }),
  );
  // A repeated `?language=` arrives as a list, which names none.
  const language =
    typeof query.language === "string"
      ? query.language
      : project.sourceLanguage;
  // This row's place in the queue, not the whole queue (#639).
  const queue = queueKind
    ? queueStep(db, project.id, queueKind, { stringId: string.id, language })
    : undefined;
  const source = translations[project.sourceLanguage];
  // A target language selected in the URL turns the page into the editor
  // (§9.3): the source pane stays, the target pane appears. Queue links
  // select it for the untranslated and stale queues.
  // The languages this string takes (#1006): one its source does not
  // ship is no target, as a language the project lacks is not.
  const languages = takenLanguages(project.languages, string.languages);
  const target =
    language !== project.sourceLanguage && languages.includes(language)
      ? language
      : undefined;
  const targetRow = target ? translations[target] : undefined;
  const carried = targetRow && carriedFrom(query, targetRow.version);
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
  // printf's verb as the source writes it, so a chip inserts `%[2]s`
  // and not `{2}` (#594).
  const { placeholders, formats, written } = partsOf(
    string.source,
    string.syntax,
    string.placeholderSyntaxes ?? undefined,
  );
  const slots: Slot[] = inPositionOrder([...placeholders], string.syntax).map(
    (name) => ({
      name,
      description: described.get(name),
      format: formats.get(name),
      written: written.get(name) ?? null,
    }),
  );
  const errorKey = query.error
    ? (ERROR_KEY[query.error] ?? "verify.errorGeneric")
    : undefined;

  const editing = Boolean(target && targetRow && !string.archived);
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
  const languageBar = (
    <LanguageBar
      languages={languages}
      sourceLanguage={project.sourceLanguage}
      selected={actedLanguage}
      states={translations}
      hrefFor={languageSwitchPath({
        slug,
        key: string.key,
        sourceLanguage: project.sourceLanguage,
        queue:
          queueKind && queue
            ? { kind: queueKind, languages: queue.languages }
            : undefined,
      })}
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
      {queue ? (
        <div className="hidden lg:block">
          <QueueNav slug={slug} queue={queue} inline>
            {languageBar}
          </QueueNav>
        </div>
      ) : (
        <div className="hidden lg:block">{languageBar}</div>
      )}
      <div className="lg:hidden">{languageBar}</div>
      <div
        className={
          editing
            ? "grid gap-x-10 gap-y-8 lg:grid-cols-12 2xl:gap-x-16"
            : "max-w-2xl space-y-8"
        }
      >
        <div
          className={
            editing ? "space-y-8 lg:col-span-5 2xl:col-span-6" : "space-y-8"
          }
        >
          <header className="space-y-3">
            <p className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {string.key}
            </p>
            <SourceView
              source={string.source}
              syntax={string.syntax}
              layers={string.placeholderSyntaxes}
              declarations={declarations}
            />
            {string.stringNote && (
              <Section heading={t("string.stringNoteLabel")} level={3}>
                <NoteText text={string.stringNote} />
              </Section>
            )}
            {string.note && (
              <Section
                heading={t("string.noteLabel", { type: string.type })}
                level={3}
              >
                <NoteText text={string.note} />
              </Section>
            )}
            {isHtml(string.richText ?? undefined) && (
              <p className="text-sm text-muted-foreground">
                {string.richText === "html-key"
                  ? t("string.richTextHtmlKey")
                  : t("string.richTextHtml", { type: string.type })}
              </p>
            )}
            {target && (
              <GlossaryTerms
                entries={string.glossary[target] ?? []}
                language={target}
              />
            )}
            {string.archived && (
              <Banner tone="info">{t("string.archived")}</Banner>
            )}
            {errorKey && <Banner tone="error">{t(errorKey)}</Banner>}
            {query.warning === "changed" && (
              <Banner tone="warning">{t("verify.warningChanged")}</Banner>
            )}
            {query.warning === "source-changed" && (
              <Banner tone="warning">{t("editor.warningSourceChanged")}</Banner>
            )}
            <StateChips
              languages={languages}
              states={translations}
              shown={[project.sourceLanguage, actedLanguage].filter(
                (l, i, all) => all.indexOf(l) === i,
              )}
              foldable
            />
            <MetadataChips
              declarations={declarations}
              metadata={string.metadata ?? {}}
            />
          </header>
          {!string.archived && (
            <Section heading={t("proposal.heading")}>
              {query.proposed && (
                <Banner tone="info">{t("proposal.proposed")}</Banner>
              )}
              {query.withdrawn && (
                <Banner tone="info">{t("proposal.withdrawn")}</Banner>
              )}
              {query.proposalError && (
                <Banner tone="error">
                  {t(
                    PROPOSAL_ERROR_KEY[query.proposalError] ??
                      "proposal.errorGeneric",
                  )}
                </Banner>
              )}
              <ProposalPanel
                key={`${string.id}:${string.source}`}
                slug={slug}
                stringKey={string.key}
                language={target}
                source={string.source}
                syntax={string.syntax}
                richText={string.richText}
                slots={slots}
                writable={string.file !== null}
                keyIsText={string.keyIsText}
                generated={string.generated}
                pending={pendingProposal}
                canWithdraw={
                  pendingProposal !== undefined &&
                  (pendingProposal.authorId === user.id || user.maintainer)
                }
                history={proposalHistory}
                actions={{
                  edit: proposeEditAction,
                  remove: proposeDeleteAction,
                  withdraw: withdrawProposalAction,
                }}
              />
            </Section>
          )}
          <OtherLanguages
            languages={languages}
            exclude={[project.sourceLanguage, actedLanguage]}
            translations={translations}
          />
          <Siblings slug={slug} siblings={siblings} language={target} />
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

        <div
          className={
            editing ? "space-y-6 lg:col-span-7 2xl:col-span-6" : "space-y-6"
          }
        >
          {target && targetRow && !string.archived && (
            <section className="space-y-3">
              {targetRow.stale && (
                <Banner tone="warning">{t("editor.staleBanner")}</Banner>
              )}
              {/* The draft is one string's in one language at one version:
                  a switch of tab or a save starts it afresh (#979). */}
              <TargetPane
                key={`${string.id}:${target}:${carried?.openedVersion}`}
                action={saveString}
                source={string.source}
                syntax={string.syntax}
                layers={string.placeholderSyntaxes}
                passed={string.arguments}
                pluralForms={string.pluralForms?.[target]}
                pluralShared={string.pluralShared?.[target]}
                pluralAsForms={string.pluralAsForms}
                pluralRules={string.pluralRules}
                richText={string.richText}
                slots={slots}
                language={target}
                initialText={carried?.draft ?? targetRow.text ?? ""}
                slug={slug}
                stringKey={string.key}
                openedVersion={carried?.openedVersion ?? targetRow.version}
                queue={queueKind}
                examples={examples}
                sourceLanguage={project.sourceLanguage}
                suggestion={suggestionOf(targetRow)}
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
            {queue && <QueueNav slug={slug} queue={queue} />}
          </div>
        </div>
      )}
    </Page>
  );
}
