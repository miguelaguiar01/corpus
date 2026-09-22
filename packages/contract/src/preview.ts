// Previews are data, not code (§7): substitute an example's slot values
// into a message and resolve each select by its argument's value, each
// plural by its count's exact branch, then the language's category, then
// `other`, with `#` as the count. Pure. Missing values leave the slot
// literally ("{hour}", "#"); an unmatched select value falls back to
// `other`, then the first branch. One engine
// habit is mirrored so the fixture's own renders match: a value that
// opens the sentence is capitalised. Everything else is verbatim —
// previews are for meaning, not grammar (§7).
import {
  parseIcu,
  pluralBranch,
  type IcuError,
  type IcuNode,
  type PlaceholderFormat,
} from "./icu";
import type { Library } from "./strings";

export type PreviewResult =
  { ok: true; text: string } | { ok: false; errors: IcuError[] };

// A preview split into what the draft says and what the example put in
// (a slot's value), so an editor can show the two apart.
export type PreviewSegment = { text: string; value: boolean };
export type PreviewSegmentsResult =
  { ok: true; segments: PreviewSegment[] } | { ok: false; errors: IcuError[] };

export type PreviewExample = {
  values: Record<string, string>;
  valuesByLanguage?: Record<string, Record<string, string>>;
};

// The values a preview for `language` should use (§7): that language's
// when the example carries them, the source language's otherwise; the
// language returned is the one the values are in, for the heading.
export function exampleValues(
  example: PreviewExample,
  language: string,
  sourceLanguage: string,
): { values: Record<string, string>; language: string } {
  const own = example.valuesByLanguage?.[language];
  return own
    ? { values: own, language }
    : { values: example.values, language: sourceLanguage };
}

function render(
  nodes: IcuNode[],
  values: Record<string, string>,
  out: PreviewSegment[],
  language?: string,
): void {
  for (const node of nodes) {
    if (node.kind === "literal") out.push({ text: node.text, value: false });
    else if (node.kind === "placeholder" || node.kind === "count") {
      const name = node.kind === "placeholder" ? node.name : node.arg;
      const value = values[name];
      out.push(
        value === undefined
          ? { text: node.kind === "count" ? "#" : `{${name}}`, value: false }
          : {
              text:
                node.kind === "placeholder" && node.format
                  ? formatValue(value, node.format, language)
                  : value,
              value: true,
            },
      );
    } else if (node.kind === "tag") {
      // The component is the client's; the preview shows what it wraps.
      render(node.children, values, out, language);
    } else if (node.kind === "forms") {
      // vue-i18n picks a form by the count passed at render time, by
      // position. A preview has no count, so it shows the last form,
      // which is the one every language uses for the general case.
      render(
        node.branches[node.branches.length - 1] ?? [],
        values,
        out,
        language,
      );
    } else if (node.kind === "plural") {
      const value = values[node.arg];
      const key =
        value === undefined
          ? "other"
          : pluralBranch(node.branches, value, language);
      render(node.branches[key] ?? [], values, out, language);
    } else {
      const value = values[node.arg];
      const branch =
        (value !== undefined ? node.branches[value] : undefined) ??
        node.branches.other ??
        Object.values(node.branches)[0] ??
        [];
      render(branch, values, out, language);
    }
  }
}

// The engine habit of §7, a value that opens the sentence capitalised,
// is for previews of a project's text; chrome rendered through the same
// engine keeps its values as given.
export type RenderOptions = { capitalise?: boolean; syntax?: Library };

export function renderPreviewSegments(
  message: string,
  values: Record<string, string>,
  language?: string,
  options: RenderOptions = {},
): PreviewSegmentsResult {
  const parsed = parseIcu(message, options.syntax ?? "icu");
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const segments: PreviewSegment[] = [];
  render(parsed.nodes, values, segments, language);
  // Capitalise the first character of the whole render, wherever it
  // falls: an empty leading value must not stop it.
  const first = segments.find((segment) => segment.text.length > 0);
  if (
    options.capitalise !== false &&
    parsed.nodes[0]?.kind === "placeholder" &&
    first
  ) {
    first.text = first.text[0]!.toUpperCase() + first.text.slice(1);
  }
  return { ok: true, segments };
}

export function renderPreview(
  message: string,
  values: Record<string, string>,
  language?: string,
  options: RenderOptions = {},
): PreviewResult {
  const result = renderPreviewSegments(message, values, language, options);
  if (!result.ok) return result;
  return { ok: true, text: result.segments.map((s) => s.text).join("") };
}

export function previewsFor(
  message: string,
  examples: PreviewExample[],
  language?: { target: string; source: string },
  options: RenderOptions = {},
): PreviewResult[] {
  return examples.map((example) =>
    renderPreview(
      message,
      language
        ? exampleValues(example, language.target, language.source).values
        : example.values,
      language?.target,
      options,
    ),
  );
}

// A formatted placeholder's example value, through the runtime's Intl
// for the language when the value is a number or a date and the style
// is one Intl names; anything else is shown as written (#555).
function formatValue(
  value: string,
  format: PlaceholderFormat,
  language?: string,
): string {
  try {
    if (format.type === "number") {
      if (value.trim() === "" || Number.isNaN(Number(value))) return value;
      const style = format.style?.replace(/^::/, "");
      const options: Intl.NumberFormatOptions =
        style === "percent"
          ? { style: "percent" }
          : style === "integer"
            ? { maximumFractionDigits: 0 }
            : {};
      return new Intl.NumberFormat(language, options).format(Number(value));
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const style = format.style?.replace(/^::/, "");
    const named =
      style === "short" ||
      style === "medium" ||
      style === "long" ||
      style === "full"
        ? style
        : undefined;
    const options: Intl.DateTimeFormatOptions =
      format.type === "date"
        ? { dateStyle: named ?? "medium", timeZone: "UTC" }
        : { timeStyle: named ?? "short", timeZone: "UTC" };
    return new Intl.DateTimeFormat(language, options).format(date);
  } catch {
    return value;
  }
}
