import { appVersion } from "@/version";

// Liveness for the container plus the build's identity, so a running
// instance is traceable to a commit without logging in.
export function GET(): Response {
  return Response.json({ status: "ok", version: appVersion(process.env) });
}
