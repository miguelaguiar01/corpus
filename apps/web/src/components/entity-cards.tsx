import type { EntityCard } from "@/strings/detail";
import { cn } from "@/lib/utils";

// Entity cards (§6): one per referenced entity, the type as a quiet
// caption, attributes as a definition list with the keys aligned. Two
// columns by default; the browser widens to three from lg.
export function EntityCards({
  entities,
  className,
}: {
  entities: EntityCard[];
  className?: string;
}) {
  if (entities.length === 0) return null;
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {entities.map((entity) => (
        <li
          key={`${entity.field ?? ""}:${entity.entityId}`}
          className="space-y-2 rounded-lg border border-border p-4"
        >
          <div>
            <p className="text-xs text-muted-foreground">{entity.typeLabel}</p>
            <p className="text-base font-medium">{entity.name}</p>
          </div>
          {entity.attributes && Object.keys(entity.attributes).length > 0 && (
            <dl className="grid grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              {Object.entries(entity.attributes).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
