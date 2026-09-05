// Dependency-free auth constants: importable from the edge middleware
// (which cannot load SQLite) and from server code alike, so cookie name,
// route, limits, and error vocabulary each have exactly one home.
import type { MessageKey } from "@/i18n";

export const SESSION_COOKIE = "corpus_session";

export const INVITE_PATH = "/invite";
export const PASSWORD_PATH = "/password";

export const MAX_NAME_LENGTH = 80;

// Error codes carried in the invite redirect's ?error= param, mapped to
// their catalog message keys. Producer (actions) and consumer (page)
// both import this, so adding a code is a one-file change.
export const INVITE_ERROR_MESSAGES = {
  invalid: "invite.errorInvalid",
  credentials: "invite.errorCredentials",
  "name-taken": "invite.errorNameTaken",
  "weak-password": "invite.errorWeakPassword",
  "rate-limited": "invite.errorRateLimited",
} as const satisfies Record<string, MessageKey>;

export type InviteErrorCode = keyof typeof INVITE_ERROR_MESSAGES;

export function inviteErrorPath(code: InviteErrorCode): string {
  return `${INVITE_PATH}?error=${code}`;
}
