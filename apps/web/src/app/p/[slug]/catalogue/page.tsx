import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { searchStringIds } from "@/db/search";
import { declaredMetadataFields, deriveFacets } from "@/catalogue/facets";
import { progressCounts } from "@/catalogue/progress";
import {
  listCatalogue,
  type CatalogueFilters,
  type TranslationState,
} from "@/catalogue/query";
import { distinctTypes } from "@/catalogue/types";
import { FacetPanel } from "@/components/facet-panel";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ProgressStrip } from "@/components/progress-strip";
import { SearchBox } from "@/components/search-box";
import { StateChips } from "@/components/state-chips";
import { getProjectBySlug } from "@/projects/service";
import { stringPath } from "@/strings/paths";
import { t } from "@/i18n";

type SearchParams = Record<string, string | string[] | undefined>;

function filtersFromParams(
  params: URLSearchParams,
  declaredFields: Set<string>,
): CatalogueFilters {
  const metadata: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!key.startsWith("meta.")) continue;
    const field = key.slice("meta.".length);
    // Only declared fields reach a SQL json path (§5) — an unknown or
    // malformed field is ignored, not passed through.
    if (declaredFields.has(field)) metadata[field] = value;
  }
  const state = params.get("state");
  const language = params.get("language");
  const type = params.get("type");
  return {
    types: type ? [type] : undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    language: language ?? undefined,
    states: state ? [state as TranslationState] : undefined,
  };
}

export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();

  const active = new URLSearchParams(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const basePath = `/p/${slug}/catalogue`;

  const query = active.get("q")?.trim();
  const searchIds = query ? searchStringIds(db, project.id, query) : undefined;

  const declaredFields = declaredMetadataFields(project.stringTypes);
  const page = listCatalogue(db, project.id, {
    ...filtersFromParams(active, declaredFields),
    stringIds: searchIds,
    includeArchived: active.get("archived") === "1",
    cursor: active.get("cursor") ? Number(active.get("cursor")) : undefined,
  });
  const facets = deriveFacets(
    project.stringTypes,
    distinctTypes(db, project.id),
    project.languages,
  );
  const progress = progressCounts(db, project.id);

  return (
    <Page width="wide" className="grid gap-6 md:grid-cols-[12rem_1fr]">
      <FacetPanel basePath={basePath} facets={facets} active={active} />
      <div className="space-y-4">
        <PageHeader title={t("catalogue.heading")} />
        <ProgressStrip progress={progress} />
        <SearchBox basePath={basePath} active={active} />
        {page.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("catalogue.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {page.rows.map((row) => (
              <li key={row.stringId}>
                <Link
                  href={stringPath(slug, row.stringId)}
                  className="flex flex-col gap-1.5 py-3 hover:bg-accent/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{row.stringId}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {row.type}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-sm text-muted-foreground">
                    {row.source}
                  </p>
                  <StateChips
                    languages={project.languages}
                    states={row.states}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor !== null && (
          <NextPage
            basePath={basePath}
            active={active}
            cursor={page.nextCursor}
          />
        )}
      </div>
    </Page>
  );
}

function NextPage({
  basePath,
  active,
  cursor,
}: {
  basePath: string;
  active: URLSearchParams;
  cursor: number;
}) {
  const next = new URLSearchParams(active);
  next.set("cursor", String(cursor));
  return (
    <Link
      href={`${basePath}?${next}`}
      className="inline-block text-sm underline"
    >
      {t("catalogue.loadMore")}
    </Link>
  );
}
