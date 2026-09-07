import type { MessageKey } from "@/i18n";
import type { TranslationState } from "@/translations/state";

export const STATE_KEY: Record<TranslationState, MessageKey> = {
  untranslated: "state.untranslated",
  translated: "state.translated",
  verified: "state.verified",
};

// Three states, three treatments that survive both themes and do not
// rely on hue alone: outlined, filled achromatic, filled moss with a
// mark (docs/design.md).
export const STATE_VARIANT = {
  untranslated: "outline",
  translated: "neutral",
  verified: "state-verified",
} as const satisfies Record<TranslationState, string>;
