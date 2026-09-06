// A snapshot of a large project is well under a megabyte; the cap only
// has to keep a token holder from parking a gigabyte in memory.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
