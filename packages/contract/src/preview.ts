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
  argPositions,
  readIcu,
  pluralBranch,
  type IcuError,
  branchingNodes,
  type IcuNode,
  type PlaceholderFormat,
} from "./icu";
import type { Example, Library } from "./strings";

export type PreviewResult =
  { ok: true; text: string } | { ok: false; errors: IcuError[] };

// A preview split into what the draft says and what the example put in
// (a slot's value), so an editor can show the two apart.
export type PreviewSegment = { text: string; value: boolean };
export type PreviewSegmentsResult =
  { ok: true; segments: PreviewSegment[] } | { ok: false; errors: IcuError[] };

export type PreviewExample = Pick<Example, "values" | "valuesByLanguage">;

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

// A key read from an example or a message is data: `constructor` is one
// the record holds or lacks like any other (#846).
function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// A placeholder with no value, as the text writes it.
type Unset = (name: string) => string;
const icuUnset: Unset = (name) => `{${name}}`;
// In i18next's form, not as the source spelled it (#859): `{{ count }}`
// shows `{{count}}`; a leading `-` is its unescaped `{{- name}}`.
const i18nextUnset: Unset = (name) =>
  name.startsWith("-") ? `{{- ${name.slice(1)}}}` : `{{${name}}}`;

function render(
  nodes: IcuNode[],
  values: Record<string, string>,
  out: PreviewSegment[],
  language: string | undefined,
  unset: Unset,
  library?: Library,
  // The source's own forms and named rule, as validation reads them.
  plural: { picked?: readonly string[]; rules?: "default" | "cldr" } = {},
): void {
  for (const node of nodes) {
    if (node.kind === "literal") out.push({ text: node.text, value: false });
    else if (node.kind === "placeholder" || node.kind === "count") {
      const name = node.kind === "placeholder" ? node.name : node.arg;
      const value = own(values, name);
      out.push(
        value === undefined
          ? {
              text: node.kind === "count" ? "#" : (node.written ?? unset(name)),
              value: false,
            }
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
      render(node.children, values, out, language, unset, library, plural);
    } else if (node.kind === "forms") {
      // vue-i18n picks a form by the count passed at render time, by
      // position. A preview has no count, so it shows the last form,
      // which is the one every language uses for the general case.
      render(
        node.branches[node.branches.length - 1] ?? [],
        values,
        out,
        language,
        unset,
        library,
        plural,
      );
    } else if (node.kind === "plural") {
      const value = own(values, node.arg);
      const key =
        value === undefined
          ? "other"
          : pluralBranch(node.branches, value, language, {
              ordinal: node.ordinal,
              ...(library && { library }),
              ...plural,
            });
      render(
        own(node.branches, key) ?? [],
        values,
        out,
        language,
        unset,
        library,
        plural,
      );
    } else {
      const value = own(values, node.arg);
      const branch =
        (value !== undefined ? own(node.branches, value) : undefined) ??
        node.branches.other ??
        Object.values(node.branches)[0] ??
        [];
      render(branch, values, out, language, unset, library, plural);
    }
  }
}

// The engine habit of §7, a value that opens the sentence capitalised,
// is for previews of a project's text; chrome rendered through the same
// engine keeps its values as given.
// `pluralForms`: the categories the source's own rule picks for the
// language, which validation checks a plural by (§5, #963).
export type RenderOptions = {
  capitalise?: boolean;
  syntax?: Library;
  pluralForms?: readonly string[];
  // The source's named plural rule (#961): "cldr" under easy_localization.
  pluralRules?: "default" | "cldr";
};

// A printf plural on a named count, as a gettext plural reads whole,
// is `printf(ngettext(…, n), n)`: with no value for the count, it takes
// the first argument's, which the same call passes (#775).
function withCount(
  nodes: IcuNode[],
  values: Record<string, string>,
  syntax: Library | undefined,
): Record<string, string> {
  const first = values["1"];
  if (syntax !== "printf" || first === undefined) return values;
  const counted = Object.assign(
    Object.create(null) as Record<string, string>,
    values,
  );
  for (const node of branchingNodes(nodes))
    if (node.kind === "plural" && !/^\d+$/.test(node.arg))
      counted[node.arg] ??= first;
  return counted;
}

export function renderPreviewSegments(
  message: string,
  values: Record<string, string>,
  language?: string,
  options: RenderOptions = {},
): PreviewSegmentsResult {
  const parsed = readIcu(message, options.syntax ?? "icu");
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const segments: PreviewSegment[] = [];
  // A printf plural on `argN` takes the Nth argument's value (#735).
  const nodes =
    options.syntax === "printf" ? argPositions(parsed.nodes) : parsed.nodes;
  render(
    nodes,
    withCount(nodes, values, options.syntax),
    segments,
    language,
    options.syntax === "i18next" ? i18nextUnset : icuUnset,
    options.syntax,
    {
      ...(options.pluralForms && { picked: options.pluralForms }),
      ...(options.pluralRules && { rules: options.pluralRules }),
    },
  );
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
    // A number is epoch milliseconds, as FormatJS takes a date (#859).
    const date = new Date(/^-?\d+$/.test(value.trim()) ? Number(value) : value);
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
