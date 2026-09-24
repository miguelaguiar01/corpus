// Diff-by-ID semantics (§8), pure: current rows + snapshot → change plan
// + report counts. The ingest endpoint (#40) applies the plan in one
// transaction; keeping this pure makes the four cases table-testable.

export type CurrentString = {
  stringId: string;
  source: string;
  archived: boolean;
  // Target languages whose row is translated or verified: the rows a
  // source change marks stale. An untranslated row has nothing to go
  // stale (#620).
  translatedTargets: string[];
};

export type SnapshotString = { id: string; source: string };

// The states a source change marks stale: the diff counts the rows in
// them, the apply loop bounds its update to them, one list for both.
export const STALE_STATES = ["translated", "verified"] as const;

export type DiffLanguages = {
  sourceLanguage: string;
  targetLanguages: string[];
};

export type DiffReport = {
  added: number;
  changed: number;
  stale: number;
  archived: number;
  unarchived: number;
  unchanged: number;
  // Sources whose text was the empty string: applied as updates with
  // no stale mark, since nothing was translated against nothing (#620).
  fromEmpty: number;
};

export type DiffPlan = {
  insert: string[];
  refresh: string[];
  updateSource: string[];
  fromEmpty: string[];
  archive: string[];
  unarchive: string[];
  report: DiffReport;
};

export function diffSnapshot(
  _languages: DiffLanguages,
  current: CurrentString[],
  snapshot: SnapshotString[],
): DiffPlan {
  const byId = new Map(current.map((row) => [row.stringId, row]));
  const seen = new Set<string>();

  const plan: DiffPlan = {
    insert: [],
    refresh: [],
    updateSource: [],
    fromEmpty: [],
    archive: [],
    unarchive: [],
    report: {
      added: 0,
      changed: 0,
      stale: 0,
      archived: 0,
      unarchived: 0,
      unchanged: 0,
      fromEmpty: 0,
    },
  };

  for (const entry of snapshot) {
    seen.add(entry.id);
    const existing = byId.get(entry.id);

    if (!existing) {
      plan.insert.push(entry.id);
      plan.report.added += 1;
      continue;
    }

    if (existing.archived) {
      plan.unarchive.push(entry.id);
      plan.report.unarchived += 1;
    }

    if (existing.source === entry.source) {
      plan.refresh.push(entry.id);
      if (!existing.archived) plan.report.unchanged += 1;
    } else {
      plan.updateSource.push(entry.id);
      plan.report.changed += 1;
      if (existing.source === "") {
        plan.fromEmpty.push(entry.id);
        plan.report.fromEmpty += 1;
      } else {
        plan.report.stale += existing.translatedTargets.length;
      }
    }
  }

  for (const row of current) {
    if (!seen.has(row.stringId) && !row.archived) {
      plan.archive.push(row.stringId);
      plan.report.archived += 1;
    }
  }

  return plan;
}
