import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Users per spec §10: a display name and one flag. The first user created
// on an instance becomes a maintainer (enforced in the auth layer, #15).
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  maintainer: integer("maintainer", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Long-lived sessions (§10). Only a hash of the session token is stored;
// the cookie carries the raw token.
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});
