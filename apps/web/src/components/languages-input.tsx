"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

// The languages field of the new-project form: the text input is what
// the form posts, and the codes it holds show as chips as they are
// typed, so a translator's-eye view of the list is always in sight.
export function LanguagesInput({
  label,
  hint,
  defaultValue = "",
}: {
  label: string;
  hint?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const codes = value
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <Input
          name="languages"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="en, pt-PT"
          autoCapitalize="none"
        />
      </Field>
      {codes.length > 0 && (
        <ul
          aria-label={t("newProject.languagesChips")}
          className="flex flex-wrap gap-1.5"
        >
          {codes.map((code, index) => (
            <li key={`${code}-${index}`}>
              <Chip variant="outline">{code}</Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
