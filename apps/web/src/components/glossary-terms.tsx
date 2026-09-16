import type { GlossaryEntry } from "@corpus/contract";
import { t } from "@/i18n";
import { Section } from "@/components/ui/section";

// The glossary entries in this source (§5) for the selected target:
// term, its rendering, the note. Renders nothing on the source view or
// when no term occurs.
export function GlossaryTerms({
  entries,
  language,
}: {
  entries: GlossaryEntry[];
  language: string;
}) {
  if (entries.length === 0) return null;
  return (
    <Section heading={t("string.glossaryHeading", { language })} level={3}>
      <dl className="space-y-1 text-sm">
        {entries.map((entry) => (
          <div key={entry.term} className="flex flex-wrap items-baseline gap-2">
            <dt className="font-medium">{entry.term}</dt>
            <dd>{entry.target}</dd>
            {entry.note && (
              <dd className="text-muted-foreground">{entry.note}</dd>
            )}
          </div>
        ))}
      </dl>
    </Section>
  );
}
