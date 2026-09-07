// A snapshot of a large project is well under a megabyte; the cap only
// has to keep a token holder from parking a gigabyte in memory.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
// A project's declaration is a few short strings.
export const MAX_PROJECT_BODY_BYTES = 64 * 1024;
