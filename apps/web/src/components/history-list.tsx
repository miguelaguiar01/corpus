import type { HistoryEntry } from "@/strings/detail";
import type { TranslationState } from "@/translations/state";
import { t, type MessageKey } from "@/i18n";

const STATE_KEY: Record<TranslationState, MessageKey> = {
  untranslated: "state.untranslated",
  translated: "state.translated",
  verified: "state.verified",
};

// Rendered the same on server and client: no locale-dependent formatting.
function stamp(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ");
}

// Attributed history (§11): who, when, language, old → new state, and the
// new text when it changed. Newest first, as the query returns it.
export function HistoryList({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
    );
  }
  return (
    <ol className="divide-y divide-border text-sm">
      {history.map((entry) => (
        <li key={entry.id} className="space-y-0.5 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{entry.actor}</span>
            <span className="text-muted-foreground">{entry.language}</span>
            <span className="text-muted-foreground">
              {t("history.change", {
                from: t(STATE_KEY[entry.oldState]),
                to: t(STATE_KEY[entry.newState]),
              })}
            </span>
            <time
              dateTime={entry.at.toISOString()}
              className="ml-auto text-xs text-muted-foreground"
            >
              {stamp(entry.at)}
            </time>
          </div>
          {entry.newText !== null && entry.newText !== entry.oldText && (
            <p className="text-foreground">{entry.newText}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
