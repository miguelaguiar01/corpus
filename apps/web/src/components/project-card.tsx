import Link from "next/link";
import type { Progress } from "@/catalogue/progress";
import type { QueueCounts } from "@/catalogue/queues";
import { Chip } from "@/components/ui/chip";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";
import { QUEUE_LABEL } from "./queue-list";

// One project on the home page (§9.1): where work is waiting, before a
// translator opens anything.
export function ProjectCard({
  slug,
  name,
  languages,
  progress,
  counts,
}: {
  slug: string;
  name: string;
  languages: string[];
  progress: Progress["perLanguage"];
  counts: QueueCounts;
}) {
  return (
    <Link
      href={`/p/${slug}`}
      className="block space-y-4 rounded-lg border border-border p-4 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="space-y-2">
        <h2 className="text-lg font-medium">{name}</h2>
        <div className="flex flex-wrap gap-1.5">
          {languages.map((language) => (
            <Chip key={language} variant="outline">
              {language}
            </Chip>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {languages.map((language) => {
          const p = progress[language] ?? {
            untranslated: 0,
            translated: 0,
            verified: 0,
            stale: 0,
            total: 0,
          };
          return (
            <div key={language} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground">
                {language}
              </span>
              <ProgressBar p={p} label={language} className="h-1.5 flex-1" />
            </div>
          );
        })}
      </div>
      <dl
        aria-label={t("home.queueCounts")}
        className="flex flex-wrap gap-x-5 gap-y-1 text-sm"
      >
        {(Object.keys(QUEUE_LABEL) as (keyof QueueCounts)[]).map((kind) => (
          <div key={kind} className="flex items-baseline gap-1.5">
            <dd className="font-medium">{counts[kind]}</dd>
            <dt className="text-muted-foreground">{t(QUEUE_LABEL[kind])}</dt>
          </div>
        ))}
      </dl>
    </Link>
  );
}
