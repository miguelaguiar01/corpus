import { t } from "@/i18n";

// A source variant's note beside its language (#699).
export function VariantLabel({ source }: { source: string | undefined }) {
  if (source === undefined) return null;
  return (
    <span className="ml-2 text-xs font-normal text-muted-foreground">
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
