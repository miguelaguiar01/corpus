import Link from "next/link";
import type { LanguageState } from "@/catalogue/query";
import { Chip } from "@/components/ui/chip";
import { t } from "@/i18n";
import { StateChips } from "./state-chips";

// One string in the catalogue (§9.2). On a desktop the rows share three
// aligned columns, key and type, the project's text at the list size the
// type scale gives project text, the per-language states, so a page of
// them reads as a table; on a phone they stack.
export function CatalogueRow({
  href,
  stringId,
  type,
  source,
  languages,
  states,
  pending = false,
}: {
  href: string;
  stringId: string;
  type: string;
  source: string;
  languages: string[];
  states: Record<string, LanguageState>;
  pending?: boolean;
}) {
  return (
    <Link
      href={href}
      className="grid gap-x-8 gap-y-2 py-3 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:grid-cols-[14rem_minmax(0,1fr)_auto] md:items-start xl:grid-cols-[18rem_minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:flex-col md:items-start">
        <span className="truncate font-mono text-xs text-muted-foreground md:max-w-full">
          {stringId}
        </span>
        <Chip variant="outline">{type}</Chip>
        {pending && (
          <Chip variant="state-stale">{t("proposal.pendingMark")}</Chip>
        )}
      </div>
      <p className="line-clamp-2 min-w-0 text-lg leading-snug">{source}</p>
      <div className="md:justify-self-end">
        <StateChips languages={languages} states={states} />
      </div>
    </Link>
  );
}
