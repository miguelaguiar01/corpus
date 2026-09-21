"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

// The language switcher past a few dozen languages (§9.3): the source
// segment stays a link with its verified mark, the selected language is
// the control, and the rest sit in a list that filters on the code, so
// a project of a hundred languages does not spend the first screen on
// its bar.
export function LanguagePicker({
  languages,
  sourceLanguage,
  selected,
  sourceVerified,
  hrefFor,
}: {
  languages: string[];
  sourceLanguage: string;
  selected: string;
  sourceVerified: boolean;
  hrefFor: (language: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const targets = languages.filter((l) => l !== sourceLanguage);
  const needle = query.trim().toLowerCase();
  const shown = targets.filter((l) => l.toLowerCase().includes(needle));
  const segment =
    "flex min-h-11 items-center justify-center gap-1.5 px-3 text-base lg:min-h-8 lg:px-3.5 lg:text-sm";
  return (
    <nav
      aria-label={t("editor.languages")}
      className="relative flex overflow-visible rounded-md border border-input lg:inline-flex"
    >
      <Link
        href={hrefFor(sourceLanguage)}
        aria-current={selected === sourceLanguage ? "page" : undefined}
        className={`${segment} border-r border-input ${
          selected === sourceLanguage
            ? "bg-primary font-semibold text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        {sourceLanguage}
        {sourceVerified && (
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-state-verified text-[10px] text-state-verified-foreground"
          >
            ✓
          </span>
        )}
      </Link>
      <Button
        variant="ghost"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${segment} flex-1 rounded-none font-semibold`}
      >
        {selected === sourceLanguage ? t("editor.pickLanguage") : selected}
        <span aria-hidden="true">▾</span>
      </Button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-10 mt-1 max-h-80 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md lg:w-64"
        >
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("editor.filterLanguages")}
            className="mb-1"
          />
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {t("editor.noLanguageMatches")}
            </p>
          ) : (
            shown.map((language) => (
              <Link
                key={language}
                href={hrefFor(language)}
                role="option"
                aria-selected={language === selected}
                onClick={() => setOpen(false)}
                className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground aria-selected:font-medium"
              >
                {language}
              </Link>
            ))
          )}
        </div>
      )}
    </nav>
  );
}
