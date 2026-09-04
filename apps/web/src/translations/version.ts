// Concurrent-edit detection (§11): last-write-wins, no locking. The
// editor opens with the row's version token and submits it back; a
// mismatch means someone else saved in between. Advisory only.

export function versionOf(row: { updatedAt: Date }): number {
  return row.updatedAt.getTime();
}

export function changedSinceOpened(
  openedVersion: number | undefined,
  currentUpdatedAt: Date,
): boolean {
  return (
    openedVersion !== undefined &&
    openedVersion !== versionOf({ updatedAt: currentUpdatedAt })
  );
}
