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

export type PreviewExample = { values: Record<string, string> };

function render(nodes: IcuNode[], values: Record<string, string>): string {
  let text = "";
  for (const node of nodes) {
    if (node.kind === "literal") text += node.text;
    else if (node.kind === "placeholder") {
      text += values[node.name] ?? `{${node.name}}`;
    } else {
      const value = values[node.arg];
      const branch =
        (value !== undefined ? node.branches[value] : undefined) ??
        node.branches.other ??
        Object.values(node.branches)[0] ??
        [];
      text += render(branch, values);
    }
  }
  return text;
}

export function renderPreview(
  message: string,
  values: Record<string, string>,
): PreviewResult {
  const parsed = parseIcu(message);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  let text = render(parsed.nodes, values);
  if (parsed.nodes[0]?.kind === "placeholder" && text.length > 0) {
    text = text[0]!.toUpperCase() + text.slice(1);
  }
  return { ok: true, text };
}

export function previewsFor(
  message: string,
  examples: PreviewExample[],
): PreviewResult[] {
  return examples.map((example) => renderPreview(message, example.values));
}
