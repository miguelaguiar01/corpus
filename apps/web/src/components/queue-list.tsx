import Link from "next/link";
import type { QueueCounts, QueueItem, QueueKind } from "@/catalogue/queues";
import { t, type MessageKey } from "@/i18n";

const QUEUES: { kind: QueueKind; label: MessageKey }[] = [
  { kind: "untranslated", label: "queue.untranslated" },
  { kind: "stale", label: "queue.stale" },
  { kind: "unverifiedSource", label: "queue.unverifiedSource" },
];

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
            <span className="w-12 text-3xl font-semibold tabular-nums">
              {count}
            </span>
            <span className="text-base">{t(label)}</span>
          </>
        );
        const rowClass = "flex min-h-14 items-center gap-4 py-2";
        return (
          <li key={kind}>
            {count > 0 && item ? (
              <Link
                href={`/p/${slug}/s/${encodeURIComponent(item.key)}?queue=${kind}&language=${encodeURIComponent(item.language)}`}
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
