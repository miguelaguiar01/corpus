import type { FieldDeclaration, MetadataValue } from "@corpus/contract";
import { Chip } from "@/components/ui/chip";

// Metadata rendered generically from the type's declarations (§5): enum
// values and set flags as chips, text as a note. Placeholder slots show
// in context in the source view; refs are the entity cards' job.
export function MetadataChips({
  declarations,
  metadata,
}: {
  declarations: Record<string, FieldDeclaration>;
  metadata: Record<string, MetadataValue>;
}) {
  const chips: { key: string; label: string; title: string }[] = [];
  const notes: { key: string; text: string }[] = [];
  for (const [field, decl] of Object.entries(declarations)) {
    const value = metadata[field];
    switch (decl.type) {
      case "enum":
        if (typeof value === "string") {
          chips.push({ key: field, label: value, title: decl.description });
        }
        break;
      case "flag":
        if (value === true) {
          chips.push({ key: field, label: field, title: decl.description });
        }
        break;
      case "text":
        if (typeof value === "string" && value) {
          notes.push({ key: field, text: value });
        }
        break;
      default:
        break;
    }
  }
  if (chips.length === 0 && notes.length === 0) return null;
  return (
    <div className="space-y-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Chip key={chip.key} title={chip.title}>
              {chip.label}
            </Chip>
          ))}
        </div>
      )}
      {notes.map((note) => (
        <p key={note.key} className="text-sm text-muted-foreground">
          {note.text}
        </p>
      ))}
    </div>
  );
}
