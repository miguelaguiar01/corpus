import {
  parseIcu,
  type FieldDeclaration,
  type IcuNode,
} from "@corpus/contract";
import { CHIP } from "./metadata-chips";

// The source pane's branch view (§9.3): placeholders as chips carrying
// their declared description, each select as its argument plus one line
// per branch, never raw ICU syntax. Literal text is verbatim. A source
// that fails to parse (impossible after push validation) shows as text.
export function SourceView({
  source,
  declarations,
  className = "text-2xl leading-snug",
}: {
  source: string;
  declarations: Record<string, FieldDeclaration>;
  className?: string;
}) {
  const parsed = parseIcu(source);
  if (!parsed.ok) return <p className={className}>{source}</p>;
  const slots = slotDescriptions(declarations);
  return <p className={className}>{renderNodes(parsed.nodes, slots)}</p>;
}

function slotDescriptions(
  declarations: Record<string, FieldDeclaration>,
): Map<string, string> {
  const slots = new Map<string, string>();
  for (const decl of Object.values(declarations)) {
    if (decl.type !== "placeholders") continue;
    for (const [name, spec] of Object.entries(decl.slots)) {
      slots.set(
        name,
        spec.role ? `${spec.description} (${spec.role})` : spec.description,
      );
    }
  }
  return slots;
}

function renderNodes(nodes: IcuNode[], slots: Map<string, string>) {
  return nodes.map((node, index) => {
    if (node.kind === "literal") return node.text;
    if (node.kind === "placeholder") {
      return (
        <span
          key={index}
          className={`${CHIP} align-middle`}
          title={slots.get(node.name)}
        >
          {`{${node.name}}`}
        </span>
      );
    }
    return (
      <span
        key={index}
        role="group"
        aria-label={node.arg}
        className="mx-0.5 inline-flex flex-col rounded-md border border-border px-2 py-1 align-middle text-base leading-snug"
      >
        <span className="text-xs text-muted-foreground">{node.arg}</span>
        {Object.entries(node.branches).map(([key, branch]) => (
          <span key={key}>
            <span className="mr-1.5 text-xs text-muted-foreground">{key}</span>
            {renderNodes(branch, slots)}
          </span>
        ))}
      </span>
    );
  });
}
