"use client";

import { useState } from "react";
import type { LanguageProgress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";

// A dashboard table row (§9.1): the language's bar, and, behind a
// disclosure when the project has more than one string type, a bar per
// type, so a many-language project keeps the breakdown without the wall.
export function ProgressRow({
  language,
  p,
  types,
}: {
  language: string;
  p: LanguageProgress;
  types: { type: string; p: LanguageProgress }[];
}) {
  const [open, setOpen] = useState(false);
  const summary = t("progress.summary", {
    verified: p.verified,
    translated: p.translated,
    total: p.total,
  });
  return (
    <>
      <tr className="border-t border-border">
        <th scope="row" className="w-16 py-1.5 text-left font-medium">
          {types.length > 1 ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className="text-xs text-muted-foreground"
              >
                {open ? "▾" : "▸"}
              </span>
              {language}
            </button>
          ) : (
            language
          )}
        </th>
        <td className="py-1.5 pr-3">
          <ProgressBar p={p} label={language} className="h-1.5" />
        </td>
        <td className="hidden w-48 py-1.5 text-right text-xs text-muted-foreground sm:table-cell">
          {summary}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={2} className="pb-2 pl-6">
            <dl className="space-y-1.5">
              {types.map(({ type, p: tp }) => (
                <div key={type} className="flex items-center gap-3 text-sm">
                  <dt className="w-28 shrink-0 truncate text-muted-foreground">
                    {type}
                  </dt>
                  <dd className="flex-1">
                    <ProgressBar p={tp} label={type} className="h-1.5" />
                  </dd>
                </div>
              ))}
            </dl>
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      )}
    </>
  );
}
