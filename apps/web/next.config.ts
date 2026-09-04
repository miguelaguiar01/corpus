import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native module — must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3"],
  // Migration SQL is read from disk at runtime; make sure the standalone
  // output ships it.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*"],
  },
};

export default nextConfig;
