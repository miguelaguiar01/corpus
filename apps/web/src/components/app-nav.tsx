"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type MessageKey } from "@/i18n";

type Item = {
  key: MessageKey;
  path: string;
  matches: (rest: string) => boolean;
};

// Strings live in the catalogue, so the editor (/s/…) keeps it marked.
const ITEMS: Item[] = [
  { key: "nav.overview", path: "", matches: (rest) => rest === "" },
  {
    key: "nav.catalogue",
    path: "/catalogue",
    matches: (rest) => rest.startsWith("/catalogue") || rest.startsWith("/s/"),
  },
  {
    key: "nav.entities",
    path: "/entities",
    matches: (rest) => rest.startsWith("/entities"),
  },
];
const SETTINGS: Item = {
  key: "nav.settings",
  path: "/settings",
  matches: (rest) => rest.startsWith("/settings"),
};

export function AppNav({
  slug,
  maintainer,
}: {
  slug: string;
  maintainer: boolean;
}) {
  const base = `/p/${slug}`;
  const rest = (usePathname() ?? "").split("?")[0]!.slice(base.length);
  const items = maintainer ? [...ITEMS, SETTINGS] : ITEMS;
  return (
    <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map((item) => {
        const active = item.matches(rest);
        return (
          <Link
            key={item.key}
            href={`${base}${item.path}`}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 py-1 ${
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
