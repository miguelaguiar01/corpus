import type { MessageKey } from "@/i18n";
import type { TranslationState } from "@/translations/state";

export const STATE_KEY: Record<TranslationState, MessageKey> = {
  untranslated: "state.untranslated",
  translated: "state.translated",
  verified: "state.verified",
};
