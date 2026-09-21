// A snapshot carries the repository's translations as seeds on every
// push, 8 MB for 3,000 strings in 35 languages, so the cap is sized for
// a few times that; it only has to keep a token holder from parking a
// gigabyte in memory. It applies to the body as read, after gunzip.
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
// A gzipped body is accepted from this size on the CLI's side; the
// server takes either.
export const GZIP_FROM_BYTES = 256 * 1024;
// A project's declaration is a few short strings.
export const MAX_PROJECT_BODY_BYTES = 64 * 1024;
