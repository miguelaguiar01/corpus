import type { ValidationError } from "@corpus/contract";
import { t } from "@/i18n";

// The contract's validation errors are data; this is where they become
// chrome text ("Missing {witness}"), so the same rule reads the same in
// the editor and on the page after a server-side rejection.
export function validationMessage(error: ValidationError): string {
  switch (error.code) {
    case "missing-placeholder":
      return t("editor.missingPlaceholder", { name: `{${error.name}}` });
    case "unexpected-placeholder":
      return t("editor.unexpectedPlaceholder", { name: `{${error.name}}` });
    case "unknown-select":
      return t("editor.unknownSelect", { arg: error.arg });
    case "missing-branch":
      return t("editor.missingBranch", { arg: error.arg, key: error.key });
    case "unexpected-branch":
      return t("editor.unexpectedBranch", { arg: error.arg, key: error.key });
    case "invalid-icu":
      return t("editor.invalidIcu", { message: error.message });
  }
}
