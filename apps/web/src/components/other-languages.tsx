import { t } from "@/i18n";
import type { StringDetail } from "@/strings/detail";
import { Chip } from "@/components/ui/chip";
import { Section } from "@/components/ui/section";
import { STATE_KEY, STATE_VARIANT } from "./state-label";

// Past this many, the rest fold away: a project of dozens of languages
// would otherwise put every text under the editor on every string.
const OTHER_LANGUAGES_SHOWN = 5;

// The same sentence in the other languages (§9.3): every language of
// the project except the source and the one being read, so a
// translator can lean on a finished translation without leaving the
// string. Read only; nothing here saves. Renders nothing when no other
// language remains; the first few open, the rest behind their count.
export function OtherLanguages({
  languages,
  exclude,
  translations,
}: {
  languages: string[];
  exclude: string[];
  translations: StringDetail["translations"];
}) {
  const others = languages.filter((l) => !exclude.includes(l));
  if (others.length === 0) return null;
  const shown = others.slice(0, OTHER_LANGUAGES_SHOWN);
  const folded = others.slice(OTHER_LANGUAGES_SHOWN);
  return (
    <Section heading={t("string.otherLanguagesHeading")}>
      <dl className="space-y-2">{shown.map(row)}</dl>
      {folded.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("string.otherLanguagesMore", { count: folded.length })}
          </summary>
          <dl className="mt-2 space-y-2">{folded.map(row)}</dl>
        </details>
      )}
    </Section>
  );

  function row(language: string) {
    const entry = translations[language];
    const state = entry?.state ?? "untranslated";
    const hasText = Boolean(entry?.text);
    return (
      <div key={language} className="flex flex-wrap items-baseline gap-2">
        <dt className="flex items-center gap-1.5">
          <span className="font-medium">{language}</span>
          <Chip variant={STATE_VARIANT[state]}>{t(STATE_KEY[state])}</Chip>
          {entry?.stale && (
            <Chip variant="state-stale">{t("state.stale")}</Chip>
          )}
        </dt>
        <dd
          className={
            hasText ? "text-base leading-relaxed" : "text-muted-foreground"
          }
        >
          {hasText ? entry?.text : t("string.otherLanguagesNone")}
        </dd>
      </div>
    );
  }
}
