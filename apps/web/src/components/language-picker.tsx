"use client";

import Link from "next/link";
import { PopoverList } from "@/components/popover-list";
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
      <PopoverList
        label={
          <>
            {source.current ? t("editor.pickLanguage") : selected}
            <span aria-hidden="true">▾</span>
          </>
        }
        options={targets.map(({ code, href }) => ({
          id: code,
          href,
          label: code,
          selected: code === selected,
        }))}
        filter={(option, needle) => option.id.toLowerCase().includes(needle)}
        placeholder={t("editor.filterLanguages")}
        empty={t("editor.noLanguageMatches")}
        controlVariant="ghost"
        controlClassName={`${SEGMENT} h-auto flex-1 rounded-none py-0 font-semibold`}
        listClassName="w-full min-w-56 lg:w-64"
      />
    </nav>
  );
}
