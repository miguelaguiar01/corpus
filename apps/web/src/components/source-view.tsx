import {
  branchingNodes,
  readIcu,
  type FieldDeclaration,
  type IcuNode,
  type Library,
  placeholderFormatText,
} from "@corpus/contract";
import { chipVariants } from "@/components/ui/chip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

// The source (§9.3) reads as one sentence at one size: placeholders as
// mono chips, each select or plural as its branches inline ("visto /
// vista", "# marca / # marcas") with the argument on demand, and a strip
// below that names every argument and key. Punctuation stays attached. A
// source that fails to parse (impossible after push validation) shows as
// text.
export function SourceView({
  source,
  syntax = "icu",
  declarations,
  layers = null,
  className = "text-xl lg:text-2xl",
}: {
  source: string;
  syntax?: Library;
  // The syntaxes its source layers on the library (#1049).
  layers?: Library[] | null;
  declarations: Record<string, FieldDeclaration>;
  className?: string;
}) {
  const parsed = readIcu(source, syntax, layers ?? undefined);
  if (!parsed.ok) return <p className={className}>{source}</p>;
  const slots = slotDescriptions(declarations);
  const selects = branchingNodes(parsed.nodes, false);
  return (
    <div className="space-y-3">
      <p className={className}>{renderNodes(parsed.nodes, slots, syntax)}</p>
      {selects.length > 0 && (
        <dl
          role="group"
          aria-label={t("source.branches")}
          className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
        >
          {selects.map((node, index) => (
            <Branches key={index} node={node} slots={slots} syntax={syntax} />
          ))}
        </dl>
      )}
    </div>
  );
}

// An argument and its keys; a branch that holds another argument names
// it, then lists that one's keys beside it, one level in (#765, #769).
function Branches({
  node,
  slots,
  syntax,
}: {
  node: Extract<IcuNode, { kind: "select" | "plural" }>;
  slots: Map<string, string>;
  syntax: Library;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="font-mono">
        {node.arg}
        {node.kind === "plural" && node.ordinal && (
          <span className="ml-1 font-sans">{t("source.ordinal")}</span>
        )}
      </dt>
      {Object.entries(node.branches).map(([key, branch]) => {
        const nested = branchingNodes(branch, false);
        return (
          <dd key={key} className="flex items-baseline gap-1">
            <span className="font-mono">{key}</span>
            <span className="text-foreground">
              {renderNodes(branch, slots, syntax, false, true)}
            </span>
            {nested.length > 0 && (
              <dl className="flex flex-wrap gap-x-3 border-l border-input pl-2">
                {nested.map((inner, index) => (
                  <Branches
                    key={index}
                    node={inner}
                    slots={slots}
                    syntax={syntax}
                  />
                ))}
              </dl>
            )}
          </dd>
        );
      })}
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

// `named`: a select or plural reads as its argument, where the strip
// lists its keys beside it (#769).
function renderNodes(
  nodes: IcuNode[],
  slots: Map<string, string>,
  syntax: Library,
  nested = false,
  named = false,
) {
  return nodes.map((node, index) => {
    if (node.kind === "literal") return node.text;
    if (node.kind === "tag") {
      return (
        <span
          key={index}
          className="rounded-sm border border-dashed border-input px-0.5"
          title={`<${node.attrs ? `${node.name} ${node.attrs}` : node.name}>`}
          data-tag={node.name}
        >
          {node.children.length > 0 ? (
            renderNodes(node.children, slots, syntax, nested, named)
          ) : (
            <span className="font-mono text-[0.6em] text-muted-foreground">
              {`<${node.name}>`}
            </span>
          )}
        </span>
      );
    }
    if (node.kind === "placeholder" || node.kind === "count") {
      const name = node.kind === "placeholder" ? node.name : node.arg;
      return (
        <span key={index} className={PLACEHOLDER} title={slots.get(name)}>
          {node.kind === "placeholder"
            ? chipText(
                name,
                syntax,
                node.format ? placeholderFormatText(node.format) : null,
                node.written,
              )
            : "#"}
        </span>
      );
    }
    // vue-i18n's forms have no argument: the count is passed at render
    // time rather than named in the string.
    const label = node.kind === "forms" ? undefined : node.arg;
    if (named && node.kind !== "forms")
      return (
        <span key={index} className={PLACEHOLDER}>
          {chipText(node.arg, syntax)}
        </span>
      );
    const branches =
      node.kind === "forms" ? node.branches : Object.values(node.branches);
    // A nested argument's branches are bracketed, so they read apart
    // from its outer one's.
    const inner = node.kind !== "forms";
    return (
      <span key={index} role="group" aria-label={label} title={label}>
        {nested && <span className="text-muted-foreground">(</span>}
        {branches.map((branch, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground">{SLASH}</span>}
            {renderNodes(branch, slots, syntax, inner)}
          </span>
        ))}
        {nested && <span className="text-muted-foreground">)</span>}
      </span>
    );
  });
}

// A placeholder as the source writes it, so the chip reads as the text;
// a formatted one carries its format, `{n, number, ::percent}` (#555).
// `written` is the placeholder as the source writes it when that is not
// its name: printf's `%s` (#594).
export function chipText(
  name: string,
  syntax: Library,
  format?: string | null,
  written?: string | null,
): string {
  if (written) return written;
  if (syntax === "i18next") return `{{${name}}}`;
  return format ? `{${name}, ${format}}` : `{${name}}`;
}
