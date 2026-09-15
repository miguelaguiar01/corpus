import Link from "next/link";
import type { LanguageState } from "@/catalogue/query";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

// The language switcher (§9.3): one segment per language of the
// project, the selected one solid, the source language first with its
// verified mark; each a link to the same string in that language, the
// queue kept when the row is in it (languageSwitchPath). Full width and
// thumb height on a phone, a slim inline control on a desktop.
export function LanguageBar({
  languages,
  sourceLanguage,
  selected,
  states,
  hrefFor,
}: {
  languages: string[];
  sourceLanguage: string;
  selected: string;
  states: Record<string, LanguageState>;
  hrefFor: (language: string) => string;
}) {
  return (
    <nav
      aria-label={t("editor.languages")}
      className="grid overflow-hidden rounded-md border border-input lg:inline-grid"
      style={{
        gridTemplateColumns: `repeat(${languages.length}, minmax(0, 1fr))`,
      }}
    >
      {languages.map((language, index) => {
        const current = language === selected;
        const verified =
          language === sourceLanguage && states[language]?.state === "verified";
        return (
          <Link
            key={language}
            href={hrefFor(language)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 px-3 text-[15px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:min-h-8 lg:px-3.5 lg:text-sm",
              index > 0 && "border-l border-input",
              current
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {language}
            {verified && (
              <span
                aria-hidden="true"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-state-verified text-[10px] text-state-verified-foreground"
              >
                ✓
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
