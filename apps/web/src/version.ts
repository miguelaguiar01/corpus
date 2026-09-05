// The running app's version: the git SHA (and tag) stamped into the
// image at build time as CORPUS_VERSION, or "dev" when unstamped. This
// is the build's identity; the snapshot contract version (corpus/1, §4)
// is a different thing.
export function appVersion(env: Record<string, string | undefined>): string {
  const stamp = env.CORPUS_VERSION?.trim();
  return stamp ? stamp : "dev";
}
