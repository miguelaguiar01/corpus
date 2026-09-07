import Link from "next/link";
import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { Chip, chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { STATE_KEY } from "./state-label";

// Three states, three treatments that survive both themes and do not
// rely on hue alone: outlined, filled achromatic, filled moss with a
// mark.
const STATE_VARIANT = {
  untranslated: "outline",
  translated: "neutral",
  verified: "state-verified",
} as const satisfies Record<LanguageState["state"], string>;

// With `hrefFor`, the chips are the editor's language switcher (§9.3):
// each a link to the same string in that language, the selected one
// marked for assistive technology and by weight and underline on the
// language itself, never by colour alone.
export function StateChips({
  languages,
  states,
  hrefFor,
  selected,
}: {
  languages: string[];
  states: Record<string, LanguageState>;
  hrefFor?: (language: string) => string;
  selected?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {languages.map((language) => {
        const value = states[language];
        const state = value?.state ?? "untranslated";
        const current = hrefFor !== undefined && language === selected;
        const content = (
          <>
            {state === "verified" && <span aria-hidden="true">✓</span>}
            <span
              className={cn(
                "font-medium",
                current && "font-semibold underline underline-offset-4",
              )}
            >
              {language}
            </span>
            {value?.stale && (
              <span className="rounded-sm bg-state-stale px-1 text-state-stale-foreground">
                {t("state.stale")}
              </span>
            )}
          </>
        );
        if (!hrefFor) {
          return (
            <Chip
              key={language}
              variant={STATE_VARIANT[state]}
              title={t(STATE_KEY[state])}
            >
              {content}
            </Chip>
          );
        }
        return (
          <Link
            key={language}
            href={hrefFor(language)}
            title={t(STATE_KEY[state])}
            aria-current={current ? "page" : undefined}
            className={chipVariants({
              variant: STATE_VARIANT[state],
              className:
                "hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            })}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
