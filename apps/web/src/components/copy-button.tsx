"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

// Copies a value to the clipboard and says so for a moment. Where the
// clipboard is unavailable (an insecure origin) the button does nothing
// and the text stays selectable.
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The text is still there to select.
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? t("settings.copied") : t("settings.copyToken")}
    </Button>
  );
}
