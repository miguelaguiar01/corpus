import type { NextConfig } from "next";
import { MAX_BODY_BYTES } from "./src/api/limits";

// Security headers on every response (§10).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Browsers ignore it over plain http, so a local run is unaffected.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Next clones every request body for the proxy (proxy.ts) and cuts
  // the clone past 10 MB by default: a push whose gzipped body passes
  // that, Bitwarden's 11 MB, arrived cut and was refused as invalid
  // gzip (#593). The limit is the push route's own cap, one number.
  // The key is experimental in Next 16.3; an unknown experimental key
  // is a build warning, not an error, so a rename would show as the
  // 10 MB cut coming back.
  experimental: { proxyClientMaxBodySize: MAX_BODY_BYTES },
  // Native module — must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Migration SQL is read from disk at runtime; make sure the standalone
  // output ships it.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
  headers() {
    return Promise.resolve([{ source: "/(.*)", headers: securityHeaders }]);
  },
};

export default nextConfig;
