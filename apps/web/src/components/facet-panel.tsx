import Link from "next/link";
import type { Facet } from "@/catalogue/facets";
import { t, type MessageKey } from "@/i18n";
import { chipVariants } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

export const BUILTIN_LABEL: Record<string, MessageKey> = {
  type: "facet.type",
  state: "facet.state",
  language: "facet.language",
  archived: "facet.archived",
};

// Server-driven: each option is a Link that toggles its value in the query
// string. Rendered generically from the facet list (§9.2).
export function FacetPanel({
  basePath,
  facets,
  active,
}: {
  basePath: string;
  facets: Facet[];
  active: URLSearchParams;
}) {
  return (
    <aside className="space-y-5 text-sm md:sticky md:top-6 md:max-h-[calc(100dvh-3rem)] md:self-start md:overflow-y-auto [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
      {facets.map((facet) => {
        if (facet.kind === "archived") {
          const on = active.get("archived") === "1";
          return (
            <FacetLink
              key="archived"
              basePath={basePath}
              active={active}
              param="archived"
              value="1"
              label={t("facet.archived")}
              selected={on}
              block
            />
          );
        }
        const options =
          facet.kind === "flag"
            ? ["true", "false"]
            : "options" in facet
              ? facet.options
              : [];
        // A declared field is headed by its name; its description, a
        // sentence, is the tooltip rather than a heading.
        if (options.length === 0) return null;
        const heading =
          "field" in facet ? facet.field : t(BUILTIN_LABEL[facet.key]!);
        const description = "label" in facet ? facet.label : undefined;
        return (
          <div key={facet.key} className="space-y-1.5">
            <p
              className="font-medium"
              title={description !== heading ? description : undefined}
            >
              {heading}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => (
                <FacetLink
                  key={option}
                  basePath={basePath}
                  active={active}
                  param={facet.key}
                  value={option}
                  label={option}
                  selected={active.get(facet.key) === option}
                />
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function FacetLink({
  basePath,
  active,
  param,
  value,
  label,
  selected,
  block,
}: {
  basePath: string;
  active: URLSearchParams;
  param: string;
  value: string;
  label: string;
  selected: boolean;
  block?: boolean;
}) {
  const next = new URLSearchParams(active);
  if (selected) next.delete(param);
  else next.set(param, value);
  next.delete("cursor");
  const href = `${basePath}${next.toString() ? `?${next}` : ""}`;
  return (
    <Link
      href={href}
      className={cn(
        chipVariants({ variant: selected ? "solid" : "outline" }),
        block && "flex",
        !selected && "hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}
