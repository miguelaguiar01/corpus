import Link from "next/link";
import { t } from "@/i18n";
import { Chip } from "@/components/ui/chip";
import { Section } from "@/components/ui/section";
import type { Siblings as SiblingsData } from "@/strings/siblings";
import { stringPath } from "@/strings/paths";
import { STATE_KEY, STATE_VARIANT } from "./state-label";

// The strings this one is translated as a set with (§9.3): the ten
// nearest by key, each a link, with the selected target's text and
// state when a target is selected. Renders nothing when there are none.
export function Siblings({
  slug,
  siblings,
  language,
}: {
  slug: string;
  siblings: SiblingsData;
  // The selected target language, or undefined on the source view.
  language?: string;
}) {
  if (siblings.total === 0) return null;
  return (
    <Section
      heading={t("string.siblingsHeading")}
      description={t("string.siblingsCount", {
        shown: siblings.items.length,
        total: siblings.total,
      })}
    >
      <ul className="divide-y divide-border">
        {siblings.items.map((sibling) => {
          const row = language ? sibling.translations[language] : undefined;
          const state = row?.state ?? "untranslated";
          return (
            <li key={sibling.key} className="py-2">
              <Link
                href={stringPath(
                  slug,
                  sibling.key,
                  language ? { language } : {},
                )}
                className="block rounded-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <div className="font-mono text-xs text-muted-foreground">
                  {sibling.key}
                </div>
                <div className="text-base leading-relaxed">
                  {sibling.source}
                </div>
                {language && (
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <Chip variant={STATE_VARIANT[state]}>
                      {t(STATE_KEY[state])}
                    </Chip>
                    {row?.stale && (
                      <Chip variant="state-stale">{t("state.stale")}</Chip>
                    )}
                    <span className={row?.text ? "" : "text-muted-foreground"}>
                      {row?.text ?? t("string.otherLanguagesNone")}
                    </span>
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
