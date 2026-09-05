import Link from "next/link";
import { neighbours, type Queue, type QueueItem } from "@/catalogue/queues";
import { stringPath } from "@/strings/paths";
import { t } from "@/i18n";
import { QUEUE_LABEL } from "./queue-list";

const STEP =
  "flex min-h-12 flex-1 items-center justify-center rounded-md text-base";

// Previous/next through the active queue, at thumb height (§9.3).
export function QueueNav({
  slug,
  queue,
  current,
}: {
  slug: string;
  queue: Queue;
  current: Pick<QueueItem, "stringId" | "language">;
}) {
  const { index, previous, next } = neighbours(queue, current);
  if (index === null) {
    return (
      <nav className="flex justify-center py-2 text-sm">
        <Link href={`/p/${slug}`} className="underline">
          {t(QUEUE_LABEL[queue.kind])}
        </Link>
      </nav>
    );
  }
  const step = (item: QueueItem | null, label: string) =>
    item ? (
      <Link
        href={stringPath(slug, item.key, {
          queue: queue.kind,
          language: item.language,
        })}
        className={`${STEP} hover:bg-accent focus-visible:bg-accent focus-visible:outline-none`}
      >
        {label}
      </Link>
    ) : (
      <span className={`${STEP} text-muted-foreground`}>{label}</span>
    );
  return (
    <nav className="flex items-center gap-2">
      {step(previous, t("queue.previous"))}
      <span className="text-sm text-muted-foreground">
        {t("queue.position", { index: index + 1, count: queue.count })}
      </span>
      {step(next, t("queue.next"))}
    </nav>
  );
}
