import Link from "next/link";
import type { Facet } from "@/catalogue/facets";
import { chipVariants } from "@/components/ui/chip";
import { t } from "@/i18n";
import { BUILTIN_LABEL } from "./facet-panel";

// Only what the page actually filters by (facet keys, archived, a
// non-blank search) becomes a chip.
export function ActiveFilters({
  basePath,
  facets,
  active,
}: {
  basePath: string;
  facets: Facet[];
  active: URLSearchParams;
}) {
  const label = (key: string): string => {
    const facet = facets.find((f) => f.key === key);
    if (facet && "label" in facet) return facet.label;
    const builtin = BUILTIN_LABEL[key];
    return builtin ? t(builtin) : key;
  };
  const known = new Set(["q", "archived", ...facets.map((f) => f.key)]);
  const filters = [...active]
    .filter(([key, value]) => known.has(key) && value.trim() !== "")
    .map(([key, value]) => ({
      key,
      text:
        key === "q" ? value : key === "archived" ? t("facet.archived") : value,
      title: key === "q" ? t("catalogue.search") : label(key),
    }));
  if (filters.length === 0) return null;
  return (
    <ul
      aria-label={t("catalogue.filters")}
      className="flex flex-wrap items-center gap-1.5"
    >
      {filters.map((filter) => {
        const next = new URLSearchParams(active);
        next.delete(filter.key);
        next.delete("cursor");
        return (
          <li key={filter.key}>
            <Link
              href={`${basePath}${next.toString() ? `?${next}` : ""}`}
              title={filter.title}
              aria-label={t("catalogue.removeFilter", { label: filter.text })}
              className={chipVariants({
                variant: "solid",
                className: "min-h-7 hover:bg-primary/80",
              })}
            >
              {filter.text}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
