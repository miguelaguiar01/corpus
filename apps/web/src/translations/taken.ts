import { sql } from "drizzle-orm";
import { strings, stringTranslations } from "@/db/schema";

// A row its string takes (#1006): every row of a string that names no
// languages, else those it names. A row outside, kept for the
// translation it holds after a source's set narrowed, is shown, counted
// and pulled nowhere.
// The set is a JSON array of language tags, which hold no quote, so a
// quoted tag's position in its text is a match: half the cost of
// json_each in the progress counts (#1006).
export const takenRow = sql`(${strings.languages} is null or instr(${strings.languages}, '"' || ${stringTranslations.language} || '"') > 0)`;

// The same, for the raw queries that alias the tables `s` and `st`.
export const takenRowAliased = sql.raw(
  `(s.languages is null or instr(s.languages, '"' || st.language || '"') > 0)`,
);
