import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Section } from "@/components/ui/section";
import { t } from "@/i18n";

// Pending adds (§9.2, §11): a new string has no row until a push lands
// it, so the catalogue lists the proposals themselves; the withdraw
// shows to the author or a maintainer, and the service decides again.
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
    canWithdraw: boolean;
  }[];
  withdraw: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <Section heading={t("proposal.pendingAddsHeading")} meta={adds.length}>
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
              {t("proposal.byInto", { author: add.author, file: add.file })}
            </span>
            {add.canWithdraw && (
              <form action={withdraw}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="proposalId" value={add.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t("proposal.withdraw")}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
