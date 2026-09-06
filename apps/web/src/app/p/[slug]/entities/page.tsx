import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { SearchBox } from "@/components/search-box";
import { chipVariants } from "@/components/ui/chip";
import { entitiesByType, filterGroups, typeCounts } from "@/entities/browser";
import { getProjectBySlug } from "@/projects/service";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/ui/section";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

// Entity browser (§9.4): read-only cards per entity type, one type at a
// time or searched by name once a project has hundreds.
export default async function EntitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; q?: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const { type, q } = await searchParams;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const all = entitiesByType(db, project.id);
  const groups = filterGroups(all, { type, q });
  const counts = typeCounts(all);
  const basePath = `/p/${slug}/entities`;
  const active = new URLSearchParams();
  if (type) active.set("type", type);
  if (q) active.set("q", q);
  const total = counts.reduce((n, c) => n + c.count, 0);
  const typeHref = (next?: string) => {
    const params = new URLSearchParams();
    if (next) params.set("type", next);
    if (q) params.set("q", q);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  const chip = (selected: boolean) =>
    cn(
      chipVariants({ variant: selected ? "solid" : "outline" }),
      !selected && "hover:text-foreground",
    );

  return (
    <Page width="wide" className="space-y-8">
      <PageHeader title={t("entities.heading")} />
      {all.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("entities.empty")}</p>
      ) : (
        <div className="space-y-4">
          <SearchBox
            basePath={basePath}
            active={active}
            placeholder={t("entities.searchPlaceholder")}
            label={t("entities.search")}
          />
          <nav
            aria-label={t("entities.types")}
            className="flex flex-wrap gap-2"
          >
            <Link href={typeHref()} className={chip(!type)}>
              {t("entities.all")} {total}
            </Link>
            {counts.map((c) => (
              <Link
                key={c.type}
                href={typeHref(c.type)}
                className={chip(type === c.type)}
              >
                {c.label} {c.count}
              </Link>
            ))}
          </nav>
        </div>
      )}
      {all.length > 0 && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("entities.noMatches")}
        </p>
      )}
      {groups.map((group) => (
        <Section
          key={group.type}
          heading={group.label}
          meta={group.entities.length}
        >
          <EntityCards entities={group.entities} className="lg:grid-cols-3" />
        </Section>
      ))}
    </Page>
  );
}
