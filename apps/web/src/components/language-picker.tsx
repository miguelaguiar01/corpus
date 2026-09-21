"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

const SEGMENT =
  "flex min-h-11 items-center justify-center gap-1.5 px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-8 lg:px-3.5 lg:text-sm";

export function LanguagePicker({
  source,
  selected,
  targets,
}: {
  source: { code: string; href: string; verified: boolean; current: boolean };
  selected: string;
  targets: { code: string; href: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = targets.filter((l) => l.code.toLowerCase().includes(needle));
  return (
    <nav
      aria-label={t("editor.languages")}
      className="relative flex rounded-md border border-input lg:inline-flex"
    >
      <Link
        href={source.href}
        aria-current={source.current ? "page" : undefined}
        className={`${SEGMENT} border-r border-input ${
          source.current
            ? "bg-primary font-semibold text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent"
        }`}
      >
        {source.code}
        {source.verified && (
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
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${SEGMENT} h-auto flex-1 rounded-none py-0 font-semibold`}
      >
        {source.current ? t("editor.pickLanguage") : selected}
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
            shown.map(({ code, href }) => (
              <Link
                key={code}
                href={href}
                role="option"
                aria-selected={code === selected}
                onClick={() => setOpen(false)}
                className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground aria-selected:font-medium"
              >
                {code}
              </Link>
            ))
          )}
        </div>
      )}
    </nav>
  );
}
