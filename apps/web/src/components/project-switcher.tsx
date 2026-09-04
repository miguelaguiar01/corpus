"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

export type ProjectOption = { slug: string; name: string };

export function ProjectSwitcher({
  current,
  projects,
}: {
  current: string;
  projects: ProjectOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = projects.find((p) => p.slug === current);
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {active?.name ?? t("switcher.label")}
      </Button>
      {open && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("switcher.placeholder")}
            className="mb-1"
          />
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              {t("switcher.empty")}
            </p>
          ) : (
            filtered.map((p) => (
              <Link
                key={p.slug}
                href={`/p/${p.slug}`}
                role="option"
                aria-selected={p.slug === current}
                onClick={() => setOpen(false)}
                className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground aria-selected:font-medium"
              >
                {p.name}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
