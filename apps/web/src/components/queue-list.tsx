import Link from "next/link";
import type { QueueCounts, QueueItem, QueueKind } from "@/catalogue/queues";
import { stringPath } from "@/strings/paths";
import { t, type MessageKey } from "@/i18n";

export const QUEUE_LABEL: Record<QueueKind, MessageKey> = {
  untranslated: "queue.untranslated",
  stale: "queue.stale",
  unverifiedSource: "queue.unverifiedSource",
};

const QUEUES = (Object.keys(QUEUE_LABEL) as QueueKind[]).map((kind) => ({
  kind,
  label: QUEUE_LABEL[kind],
}));

// The dashboard's queues (§9.1): one stacked list, each row a thumb-height
// link into the string surface at the queue's first item, carrying the
// queue so next/previous can flow through it. An empty queue is inert.
export function QueueList({
  slug,
  counts,
  first,
}: {
  slug: string;
  counts: QueueCounts;
  first: Record<QueueKind, QueueItem | null>;
}) {
  return (
    <ul className="divide-y divide-border border-y border-border">
      {QUEUES.map(({ kind, label }) => {
        const count = counts[kind];
        const item = first[kind];
        const body = (
          <>
            <span className="min-w-16 text-3xl font-semibold">{count}</span>
            <span className="text-base">{t(label)}</span>
          </>
        );
        const rowClass = "flex min-h-14 items-center gap-4 py-2";
        return (
          <li key={kind}>
            {count > 0 && item ? (
              <Link
                href={stringPath(slug, item.key, {
                  queue: kind,
                  language: item.language,
                })}
                className={`${rowClass} hover:bg-accent focus-visible:bg-accent focus-visible:outline-none`}
              >
                {body}
              </Link>
            ) : (
              <div className={`${rowClass} text-muted-foreground`}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
