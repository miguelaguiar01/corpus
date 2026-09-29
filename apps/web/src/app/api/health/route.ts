import { ACCEPTS } from "@corpus/contract";
import { appVersion } from "@/version";

// Liveness for the container plus the build's identity, so a running
// instance is traceable to a commit without logging in, and the values
// it accepts, which a push checks against first (#875).
export function GET(): Response {
  return Response.json({
    status: "ok",
    version: appVersion(process.env),
    accepts: ACCEPTS,
  });
}
