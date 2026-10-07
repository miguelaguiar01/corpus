// Items pushed one at a time: `push(...items)` passes each as an
// argument, and V8's stack overflows past about 120,000 (#1276).
export function append<T>(to: T[], items: Iterable<T>): T[] {
  for (const item of items) to.push(item);
  return to;
}
