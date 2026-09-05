import Link from "next/link";
import type { LanguageState } from "@/catalogue/query";
import { Chip } from "@/components/ui/chip";
import { StateChips } from "./state-chips";

// One string in the catalogue (§9.2): the key and type, the source, and
// the per-language state at the right on a desktop; stacked on a phone.
export function CatalogueRow({
  href,
  stringId,
  type,
  source,
  languages,
  states,
}: {
  href: string;
  stringId: string;
  type: string;
  source: string;
  languages: string[];
  states: Record<string, LanguageState>;
}) {
  return (
    <Link
      href={href}
      className="-mx-2 grid gap-x-6 gap-y-1.5 rounded-md px-2 py-2.5 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm">{stringId}</span>
          <Chip variant="outline">{type}</Chip>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{source}</p>
      </div>
      <div className="md:justify-self-end">
        <StateChips languages={languages} states={states} />
      </div>
    </Link>
  );
}
