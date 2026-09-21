import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { Chip } from "@/components/ui/chip";
import { MANY_LANGUAGES } from "./many-languages";
import { STATE_KEY, STATE_VARIANT } from "./state-label";

// Per-language state chips (§9.2): display only; the editor's switcher
// is the language bar. Past a dozen languages the strip is a wall (108
// chips is 384 px of a phone page), so it becomes a count per state,
// with the languages the caller names kept as chips and the full strip
// behind a disclosure where the markup allows one: a catalogue row is
// inside a link, which no disclosure may sit in.
export function StateChips({
  languages,
  states,
  shown = [],
  foldable = false,
}: {
  languages: string[];
  states: Record<string, LanguageState>;
  shown?: string[];
  foldable?: boolean;
}) {
  if (languages.length >= MANY_LANGUAGES) {
    const rest = languages.filter((l) => !shown.includes(l));
    const summary = (
      <>
        <Strip languages={shown} states={states} inline />
        <Counts languages={rest} states={states} />
      </>
    );
    if (!foldable) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">{summary}</div>
      );
    }
    // The marker stays, and the label says what opening gives, since the
    // chips alone are data and name the control after a language code.
    return (
      <details>
        <summary className="cursor-pointer">
          <span className="ml-1 inline-flex flex-wrap items-center gap-1.5 align-middle">
            {summary}
            <span className="text-xs text-muted-foreground">
              {t("state.eachLanguage", { n: languages.length })}
            </span>
          </span>
        </summary>
        <div className="mt-2">
          <Strip languages={languages} states={states} />
        </div>
      </details>
    );
  }
  return <Strip languages={languages} states={states} />;
}

// One chip per state that any of the languages is in, with how many.
function Counts({
  languages,
  states,
}: {
  languages: string[];
  states: Record<string, LanguageState>;
}) {
  const counts = { untranslated: 0, translated: 0, verified: 0 };
  let stale = 0;
  let drafts = 0;
  for (const language of languages) {
    const value = states[language];
    counts[value?.state ?? "untranslated"] += 1;
    if (value?.stale) stale += 1;
    if (value?.agentDraft && value.state === "translated") drafts += 1;
  }
  return (
    <>
      {STATES.map((state) =>
        counts[state] ? (
          <Chip key={state} variant={STATE_VARIANT[state]}>
            {t(COUNT_KEY[state], { n: counts[state] })}
          </Chip>
        ) : null,
      )}
      {stale > 0 && (
        <Chip variant="state-stale">{t("state.staleCount", { n: stale })}</Chip>
      )}
      {drafts > 0 && (
        <Chip variant="outline">
          {t("state.agentDraftCount", { n: drafts })}
        </Chip>
      )}
    </>
  );
}

const STATES = ["untranslated", "translated", "verified"] as const;
const COUNT_KEY = {
  untranslated: "state.untranslatedCount",
  translated: "state.translatedCount",
  verified: "state.verifiedCount",
} as const;

function Strip({
  languages,
  states,
  inline = false,
}: {
  languages: string[];
  states: Record<string, LanguageState>;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <>
        {languages.map((language) => (
          <LanguageChip key={language} language={language} states={states} />
        ))}
      </>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {languages.map((language) => (
        <LanguageChip key={language} language={language} states={states} />
      ))}
    </div>
  );
}

function LanguageChip({
  language,
  states,
}: {
  language: string;
  states: Record<string, LanguageState>;
}) {
  const value = states[language];
  const state = value?.state ?? "untranslated";
  return (
    <Chip variant={STATE_VARIANT[state]} title={t(STATE_KEY[state])}>
      {state === "verified" && <span aria-hidden="true">✓</span>}
      <span className="font-medium">{language}</span>
      {value?.stale && (
        <span className="rounded-sm bg-state-stale px-1 text-state-stale-foreground">
          {t("state.stale")}
        </span>
      )}
      {value?.agentDraft && state === "translated" && (
        <span className="rounded-sm border border-border px-1 text-muted-foreground">
          {t("state.agentDraft")}
        </span>
      )}
    </Chip>
  );
}
