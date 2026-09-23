// A snapshot carries the repository's translations as seeds on every
// push: 8 MB for 3,000 strings in 35 languages, 48 MB for Bitwarden's
// 8,617 strings in 67 languages (#593), so the cap is sized for a few
// times the largest seen. It bounds the body, not the request: one
// push at the cap costs several times it in memory while it runs, the
// inflated text, its parse and the project's rows (#604). It applies
// to the body as read, after gunzip; next.config.ts gives the proxy
// the same number.
export const MAX_BODY_BYTES = 128 * 1024 * 1024;
// A project's declaration is a few short strings.
export const MAX_PROJECT_BODY_BYTES = 64 * 1024;
