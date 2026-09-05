// Previews are data, not code (§7): substitute an example's slot values
// into a message and resolve each select by its argument's value. Pure.
// Missing values leave the slot literally ("{hour}"); an unmatched
// select value falls back to `other`, then the first branch. One engine
// habit is mirrored so the fixture's own renders match: a value that
// opens the sentence is capitalised. Everything else is verbatim —
// previews are for meaning, not grammar (§7).
import { parseIcu, type IcuError, type IcuNode } from "./icu";

export type PreviewResult =
  { ok: true; text: string } | { ok: false; errors: IcuError[] };

// A preview split into what the draft says and what the example put in
// (a slot's value), so an editor can show the two apart.
export type PreviewSegment = { text: string; value: boolean };
export type PreviewSegmentsResult =
  { ok: true; segments: PreviewSegment[] } | { ok: false; errors: IcuError[] };

export type PreviewExample = { values: Record<string, string> };

function render(
  nodes: IcuNode[],
  values: Record<string, string>,
  out: PreviewSegment[],
): void {
  for (const node of nodes) {
    if (node.kind === "literal") out.push({ text: node.text, value: false });
    else if (node.kind === "placeholder") {
      const value = values[node.name];
      out.push(
        value === undefined
          ? { text: `{${node.name}}`, value: false }
          : { text: value, value: true },
      );
    } else {
      const value = values[node.arg];
      const branch =
        (value !== undefined ? node.branches[value] : undefined) ??
        node.branches.other ??
        Object.values(node.branches)[0] ??
        [];
      render(branch, values, out);
    }
  }
}

export function renderPreviewSegments(
  message: string,
  values: Record<string, string>,
): PreviewSegmentsResult {
  const parsed = parseIcu(message);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const segments: PreviewSegment[] = [];
  render(parsed.nodes, values, segments);
  // Capitalise the first character of the whole render, wherever it
  // falls: an empty leading value must not stop it.
  const first = segments.find((segment) => segment.text.length > 0);
  if (parsed.nodes[0]?.kind === "placeholder" && first) {
    first.text = first.text[0]!.toUpperCase() + first.text.slice(1);
  }
  return { ok: true, segments };
}

export function renderPreview(
  message: string,
  values: Record<string, string>,
): PreviewResult {
  const result = renderPreviewSegments(message, values);
  if (!result.ok) return result;
  return { ok: true, text: result.segments.map((s) => s.text).join("") };
}

export function previewsFor(
  message: string,
  examples: PreviewExample[],
): PreviewResult[] {
  return examples.map((example) => renderPreview(message, example.values));
}
