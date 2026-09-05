import type { QueueKind } from "@/catalogue/queues";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// The maintainer's sign-off (§9.3). Hidden fields carry what the server
// action needs; the version token is the changed-since-opened check (§11).
export function VerifyForm({
  action,
  slug,
  stringKey,
  openedVersion,
  queue,
  language,
}: {
  action: (formData: FormData) => void | Promise<void>;
  slug: string;
  stringKey: string;
  openedVersion: number;
  queue?: QueueKind;
  // The row the sign-off acts on; named on the button so a maintainer
  // never mistakes proofreading the source for verifying a translation.
  language: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={stringKey} />
      <input type="hidden" name="openedVersion" value={openedVersion} />
      {queue && <input type="hidden" name="queue" value={queue} />}
      <input type="hidden" name="language" value={language} />
      <Button type="submit" size="lg" className="min-h-12 w-full text-base">
        {t("verify.button", { language })}
      </Button>
    </form>
  );
}
