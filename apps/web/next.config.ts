import type { NextConfig } from "next";

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
  // The proxy (proxy.ts) reads every request body, and Next truncates
  // one past 10 MB by default: a push whose gzipped body passes that,
  // Bitwarden's 11 MB, arrived cut and was refused as invalid gzip
  // (#593). The limit is the push route's own cap.
  experimental: { proxyClientMaxBodySize: "128mb" },
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
