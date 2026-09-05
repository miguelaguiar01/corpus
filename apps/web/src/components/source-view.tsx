import {
  parseIcu,
  type FieldDeclaration,
  type IcuNode,
} from "@corpus/contract";
import { chipVariants } from "@/components/ui/chip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

// The source (§9.3) reads as one sentence at one size: placeholders as
// mono chips, each select as its branches inline ("visto / vista") with
// the argument on demand, and a strip below that names every argument
// and key. Punctuation stays attached. A source that fails to parse
// (impossible after push validation) shows as text.
export function SourceView({
  source,
  declarations,
  className = "text-xl lg:text-2xl",
}: {
  source: string;
  declarations: Record<string, FieldDeclaration>;
  className?: string;
}) {
  const parsed = parseIcu(source);
  if (!parsed.ok) return <p className={className}>{source}</p>;
  const slots = slotDescriptions(declarations);
  const selects = parsed.nodes.filter((node) => node.kind === "select");
  return (
    <div className="space-y-3">
      <p className={className}>{renderNodes(parsed.nodes, slots)}</p>
      {selects.length > 0 && (
        <dl
          role="group"
          aria-label={t("source.branches")}
          className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
        >
          {selects.map((node, index) => (
            <div key={index} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="font-mono">{node.arg}</dt>
              {Object.entries(node.branches).map(([key, branch]) => (
                <dd key={key} className="flex items-baseline gap-1">
                  <span className="font-mono">{key}</span>
                  <span className="text-foreground">
                    {renderNodes(branch, slots)}
                  </span>
                </dd>
              ))}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
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

const PLACEHOLDER = cn(
  chipVariants({ variant: "key" }),
  "align-baseline px-[0.4em] py-[0.1em] text-[0.6em] leading-tight",
);

// Word, slash, word stay together; a long branch still wraps.
const SLASH = "\u00a0/\u00a0";

function renderNodes(nodes: IcuNode[], slots: Map<string, string>) {
  return nodes.map((node, index) => {
    if (node.kind === "literal") return node.text;
    if (node.kind === "placeholder") {
      return (
        <span key={index} className={PLACEHOLDER} title={slots.get(node.name)}>
          {`{${node.name}}`}
        </span>
      );
    }
    return (
      <span key={index} role="group" aria-label={node.arg} title={node.arg}>
        {Object.values(node.branches).map((branch, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground">{SLASH}</span>}
            {renderNodes(branch, slots)}
          </span>
        ))}
      </span>
    );
  });
}
