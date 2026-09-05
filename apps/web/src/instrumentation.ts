// Eager startup init (efficiency review): open the database and apply
// migrations when the server boots instead of on the first request, so
// /api/health only reports ok on a migrated DB.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb, resolvedPaths } = await import("@/db");
    getDb();
    // Say which file this instance writes to; never a guess (§2).
    console.log(`corpus: database ${resolvedPaths().dbPath}`);
  }
}
