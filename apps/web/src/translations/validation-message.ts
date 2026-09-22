import type { Library, ValidationError } from "@corpus/contract";
import { chipText } from "@/components/source-view";
import { t } from "@/i18n";

// The contract's validation errors are data; this is where they become
// chrome text ("Missing {witness}"), so the same rule reads the same in
// the editor and on the page after a server-side rejection.
export function validationMessage(
  error: ValidationError,
  syntax: Library = "icu",
): string {
  switch (error.code) {
    case "missing-placeholder":
      return t("editor.missingPlaceholder", {
        name: chipText(error.name, syntax),
      });
    case "unexpected-placeholder":
      return t("editor.unexpectedPlaceholder", {
        name: chipText(error.name, syntax),
      });
    case "unknown-select":
      return t("editor.unknownSelect", { arg: error.arg });
    case "missing-branch":
      return t("editor.missingBranch", { arg: error.arg, key: error.key });
    case "unexpected-branch":
      return t("editor.unexpectedBranch", { arg: error.arg, key: error.key });
    case "unknown-plural":
      return t("editor.unknownPlural", { arg: error.arg });
    case "missing-category":
      return t("editor.missingCategory", { arg: error.arg, key: error.key });
    case "unexpected-category":
      return t("editor.unexpectedCategory", { arg: error.arg, key: error.key });
    case "missing-tag":
      return t("editor.missingTag", { name: error.name });
    case "unexpected-tag":
      return t("editor.unexpectedTag", { name: error.name });
    case "invalid-icu":
      return t("editor.invalidIcu", { message: error.message });
    case "missing-form":
    case "unexpected-form":
      return t("editor.formCount", { have: error.have, need: error.need });
  }
}
