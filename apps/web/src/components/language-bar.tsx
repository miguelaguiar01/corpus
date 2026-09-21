import Link from "next/link";
import type { LanguageState } from "@/catalogue/query";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { LanguagePicker } from "./language-picker";
import { MANY_LANGUAGES } from "./many-languages";

// The language switcher (§9.3) under the threshold: one segment per
// language, the selected one solid, the source language first with its
// verified mark; each a link to the same string in that language, the
// queue kept when the row is in it (languageSwitchPath). Full width and
// thumb height on a phone, a slim inline control on a desktop; the
// segments wrap rather than shrink into each other.
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
  // The picker is a client component, so it takes links, not a function.
  if (languages.length >= MANY_LANGUAGES) {
    return (
      <LanguagePicker
        source={{
          code: sourceLanguage,
          href: hrefFor(sourceLanguage),
          verified: states[sourceLanguage]?.state === "verified",
          current: selected === sourceLanguage,
        }}
        selected={selected}
        targets={languages
          .filter((l) => l !== sourceLanguage)
          .map((code) => ({ code, href: hrefFor(code) }))}
      />
    );
  }
  return (
    <nav
      aria-label={t("editor.languages")}
      className="flex flex-wrap overflow-hidden rounded-md border border-input lg:inline-flex"
    >
      {languages.map((language) => {
        const current = language === selected;
        const verified =
          language === sourceLanguage && states[language]?.state === "verified";
        return (
          <Link
            key={language}
            href={hrefFor(language)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px -mr-px flex min-h-11 flex-1 items-center justify-center gap-1.5 border-b border-r border-input px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-8 lg:flex-none lg:px-3.5 lg:text-sm",
              current
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent",
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
