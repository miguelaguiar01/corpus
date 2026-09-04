// Diff-by-ID semantics (§8), pure: current rows + snapshot → change plan
// + report counts. The ingest endpoint (#40) applies the plan in one
// transaction; keeping this pure makes the four cases table-testable.

export type CurrentString = {
  stringId: string;
  source: string;
  archived: boolean;
  // Languages that already have a translation row — the rows marked stale
  // when the source changes.
  targetLanguages: string[];
};

export type SnapshotString = { id: string; source: string };

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
};

export type DiffPlan = {
  insert: string[];
  refresh: string[];
  updateSource: string[];
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
    archive: [],
    unarchive: [],
    report: {
      added: 0,
      changed: 0,
      stale: 0,
      archived: 0,
      unarchived: 0,
      unchanged: 0,
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
      plan.report.stale += existing.targetLanguages.length;
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
