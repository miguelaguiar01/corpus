import Link from "next/link";
import { notFound } from "next/navigation";
import { ActiveFilters } from "@/components/active-filters";
import { CatalogueRow } from "@/components/catalogue-row";
import { requireUser } from "@/auth/session";
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
import { getProjectBySlug } from "@/projects/service";
import { pendingAdds, pendingKeys } from "@/proposals/service";
import { withdrawProposalAction } from "@/proposals/actions";
import { PendingAdds } from "@/components/pending-adds";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
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
  await requireUser();
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
  const pending = pendingKeys(db, project.id);
  const adds = pendingAdds(db, project.id);

  return (
    <Page
      width="wide"
      className="grid gap-x-10 gap-y-6 md:grid-cols-[17rem_minmax(0,1fr)] xl:gap-x-14"
    >
      <FacetPanel basePath={basePath} facets={facets} active={active} />
      <div className="min-w-0 space-y-5">
        <PageHeader
          title={t("catalogue.heading")}
          actions={
            <Link
              href={`/p/${slug}/strings/new`}
              className={buttonVariants({ variant: "outline" })}
            >
              {t("proposal.addLink")}
            </Link>
          }
        />
        {active.get("added") && (
          <Banner tone="info">
            {t("proposal.added", { key: active.get("added") ?? "" })}
          </Banner>
        )}
        {active.get("withdrawn") && (
          <Banner tone="info">{t("proposal.withdrawn")}</Banner>
        )}
        {adds.length > 0 && (
          <PendingAdds
            slug={slug}
            adds={adds.map((a) => ({
              id: a.id,
              key: a.key,
              text: a.text ?? "",
              file: a.file,
              author: a.author,
            }))}
            withdraw={withdrawProposalAction}
          />
        )}
        <ProgressStrip progress={progress} />
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox basePath={basePath} active={active} />
          <ActiveFilters basePath={basePath} facets={facets} active={active} />
        </div>
        {page.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("catalogue.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {page.rows.map((row) => (
              <li key={row.stringId}>
                <CatalogueRow
                  href={stringPath(slug, row.stringId)}
                  stringId={row.stringId}
                  type={row.type}
                  source={row.source}
                  languages={project.languages}
                  states={row.states}
                  pending={pending.has(row.stringId)}
                />
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
