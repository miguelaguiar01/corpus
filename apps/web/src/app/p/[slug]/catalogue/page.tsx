import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { listCatalogue } from "@/catalogue/query";
import { StateChips } from "@/components/state-chips";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cursor?: string; archived?: string }>;
}) {
  const { slug } = await params;
  const { cursor, archived } = await searchParams;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();

  const page = listCatalogue(db, project.id, {
    cursor: cursor ? Number(cursor) : undefined,
    includeArchived: archived === "1",
  });

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">{t("catalogue.heading")}</h1>
      {page.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("catalogue.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {page.rows.map((row) => (
            <li key={row.stringId}>
              <Link
                href={`/p/${slug}/s/${encodeURIComponent(row.stringId)}`}
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
                <StateChips languages={project.languages} states={row.states} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor !== null && (
        <Link
          href={`/p/${slug}/catalogue?cursor=${page.nextCursor}${archived === "1" ? "&archived=1" : ""}`}
          className="inline-block text-sm underline"
        >
          {t("catalogue.loadMore")}
        </Link>
      )}
    </main>
  );
}
