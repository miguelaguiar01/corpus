// Whether a cookie set for this request may carry the Secure attribute
// (§10). A production build is not the same as HTTPS: `corpus workbench`
// serves a production build over plain http on loopback, where Safari
// drops Secure cookies and Chrome only tolerates them on "localhost".
// So Secure follows the request: HTTPS, or any host that is not
// loopback, which the README already says needs HTTPS to work.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function secureCookie(
  host: string | null,
  forwardedProto: string | null,
  protocol?: string,
  publicUrl: string | undefined = process.env.CORPUS_PUBLIC_URL,
): boolean {
  // A configured HTTPS origin settles it, whatever a client puts in Host.
  if (publicUrl?.toLowerCase().startsWith("https:")) return true;
  if (forwardedProto?.split(",")[0]?.trim() === "https") return true;
  if (protocol === "https:") return true;
  const raw = (host ?? "").trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(raw);
  const hostname = bracketed ? bracketed[1]! : raw.replace(/:\d+$/, "");
  // No host at all is not a browser on this machine; treat it as remote.
  if (hostname === "") return true;
  return !LOOPBACK.has(hostname);
}

export function secureCookieFromHeaders(headers: {
  get(name: string): string | null;
}): boolean {
  return secureCookie(headers.get("host"), headers.get("x-forwarded-proto"));
}
