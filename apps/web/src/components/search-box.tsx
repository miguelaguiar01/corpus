import { t } from "@/i18n";

// Server-driven search: a GET form. Active facet params ride along as
// hidden inputs so search composes with them; cursor resets.
export function SearchBox({
  basePath,
  active,
  placeholder = t("catalogue.searchPlaceholder"),
  label = t("catalogue.search"),
}: {
  basePath: string;
  active: URLSearchParams;
  placeholder?: string;
  label?: string;
}) {
  const hidden: [string, string][] = [];
  for (const [key, value] of active) {
    if (key !== "q" && key !== "cursor") hidden.push([key, value]);
  }
  return (
    <form action={basePath} role="search" className="w-full max-w-sm">
      {hidden.map(([key, value], i) => (
        <input key={`${key}-${i}`} type="hidden" name={key} value={value} />
      ))}
      <input
        type="search"
        name="q"
        defaultValue={active.get("q") ?? ""}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </form>
  );
}
