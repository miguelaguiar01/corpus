import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { t } from "@/i18n";

// Pending adds (§9.2, §11): a new string has no row until a push lands
// it, so the catalogue lists the proposals themselves, each withdrawable
// by its author or a maintainer (the service decides).
export function PendingAdds({
  slug,
  adds,
  withdraw,
}: {
  slug: string;
  adds: {
    id: number;
    key: string;
    text: string;
    file: string;
    author: string;
  }[];
  withdraw: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <section
      className="space-y-2"
      aria-label={t("proposal.pendingAddsHeading")}
    >
      <h2 className="text-sm font-medium text-muted-foreground">
        {t("proposal.pendingAddsHeading")}
      </h2>
      <ul className="divide-y divide-border">
        {adds.map((add) => (
          <li
            key={add.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {add.key}
            </span>
            <Chip variant="outline">{t("proposal.kindAdd")}</Chip>
            <span className="basis-full text-base leading-relaxed sm:basis-auto">
              {add.text}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("proposal.by", { author: add.author })} · {add.file}
            </span>
            <form action={withdraw}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="proposalId" value={add.id} />
              <Button type="submit" variant="outline" size="sm">
                {t("proposal.withdraw")}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
