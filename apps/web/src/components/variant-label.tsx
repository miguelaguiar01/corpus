import { t } from "@/i18n";

// A source variant's note (#699), a line of its own under its bar or
// heading: the language's column is too narrow to hold it, and every bar
// keeps one width.
export function VariantLabel({ source }: { source: string | undefined }) {
  if (source === undefined) return null;
  return (
    <span className="mt-0.5 block text-xs text-muted-foreground">
      {t("progress.variantOf", { source })}
    </span>
  );
}

// The languages in their order, a source variant after the rest.
export function inVariantOrder(
  languages: string[],
  variants: ReadonlySet<string>,
): string[] {
  return [
    ...languages.filter((l) => !variants.has(l)),
    ...languages.filter((l) => variants.has(l)),
  ];
}
