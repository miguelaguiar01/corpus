import { sql } from "drizzle-orm";
import { strings, stringTranslations } from "@/db/schema";

// A row its string takes (#1006): every row of a string that names no
// languages, else those it names. A row outside, kept for the
// translation it holds after a source's set narrowed, is shown, counted
// and pulled nowhere.
export const takenRow = sql`(${strings.languages} is null or ${stringTranslations.language} in (select value from json_each(${strings.languages})))`;

// The same, for the raw queries that alias the tables `s` and `st`.
export const takenRowAliased = sql.raw(
  "(s.languages is null or st.language in (select value from json_each(s.languages)))",
);
