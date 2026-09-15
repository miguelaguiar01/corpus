import type { ReactNode } from "react";
import Link from "next/link";
import { neighbours, type Queue, type QueueItem } from "@/catalogue/queues";
import { stringPath } from "@/strings/paths";
import { t } from "@/i18n";
import { QUEUE_LABEL } from "./queue-list";

const STEP =
  "flex min-h-12 flex-1 items-center justify-center rounded-md text-base";
const STEP_INLINE =
  "flex min-h-8 items-center justify-center rounded-md px-3 text-sm";

// Previous/next through the active queue (§9.3).
export function QueueNav({
  slug,
  queue,
  current,
  inline = false,
  children,
}: {
  slug: string;
  queue: Queue;
  current: Pick<QueueItem, "stringId" | "language">;
  // A slim toolbar under the page header on desktop; thumb height in
  // the fixed bar on a phone.
  inline?: boolean;
  // Inline only: a control beside the queue's name, left of the
  // position (the language bar, §9.3).
  children?: ReactNode;
}) {
  const stepClass = inline ? STEP_INLINE : STEP;
  const { index, previous, next } = neighbours(queue, current);
  if (index === null) {
    return (
      <nav
        aria-label={t("queue.navLabel")}
        className={
          inline
            ? "flex border-b border-border pb-3 text-sm"
            : "flex justify-center py-2 text-sm"
        }
      >
        <Link href={`/p/${slug}`} className="underline">
          {t(QUEUE_LABEL[queue.kind])}
        </Link>
        {inline && children && <div className="ml-6">{children}</div>}
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
        className={`${stepClass} hover:bg-accent focus-visible:bg-accent focus-visible:outline-none`}
      >
        {label}
      </Link>
    ) : (
      <span className={`${stepClass} text-muted-foreground`}>{label}</span>
    );
  return (
    <nav
      aria-label={t("queue.navLabel")}
      className={
        inline
          ? "flex items-center gap-1 border-b border-border pb-3"
          : "flex items-center gap-2"
      }
    >
      {inline && (
        <div className="mr-auto flex items-center gap-6">
          <span className="text-sm text-muted-foreground">
            {t(QUEUE_LABEL[queue.kind])}
          </span>
          {children}
        </div>
      )}
      {step(previous, t("queue.previous"))}
      <span className="text-sm text-muted-foreground">
        {t("queue.position", { index: index + 1, count: queue.count })}
      </span>
      {step(next, t("queue.next"))}
    </nav>
  );
}
