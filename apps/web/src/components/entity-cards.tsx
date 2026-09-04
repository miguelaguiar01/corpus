import type { EntityCard } from "@/strings/detail";

// Entity cards (§6): one per referenced entity, attributes as a
// definition list, no schema beyond the type's declared label.
export function EntityCards({ entities }: { entities: EntityCard[] }) {
  if (entities.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {entities.map((entity) => (
        <li
          key={`${entity.field}:${entity.entityId}`}
          className="rounded-lg border border-border p-3"
        >
          <p className="text-xs text-muted-foreground">{entity.typeLabel}</p>
          <p className="text-base font-medium">{entity.name}</p>
          {entity.attributes && Object.keys(entity.attributes).length > 0 && (
            <dl className="mt-2 space-y-1 text-sm">
              {Object.entries(entity.attributes).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="shrink-0 text-muted-foreground">{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
