// Eager startup init (efficiency review): open the database and apply
// migrations when the server boots instead of on the first request, so
// /api/health only reports ok on a migrated DB.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("@/db");
    getDb();
  }
}
