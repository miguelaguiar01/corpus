import { t } from "@/i18n";

// A source variant's note (#699): beside its language in a heading, or
// as a line of its own under its bar, where the column is too narrow to
// hold it and every bar keeps one width.
export function VariantLabel({
  source,
  block = false,
}: {
  source: string | undefined;
  block?: boolean;
}) {
  if (source === undefined) return null;
  const text = t("progress.variantOf", { source });
  return block ? (
    <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
  ) : (
    <>
      {" "}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {text}
      </span>
    </>
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
