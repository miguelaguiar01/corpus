"use client";

import { PopoverList } from "@/components/popover-list";
import { t } from "@/i18n";

export type ProjectOption = { slug: string; name: string };

export function ProjectSwitcher({
  current,
  projects,
}: {
  current: string;
  projects: ProjectOption[];
}) {
  const active = projects.find((p) => p.slug === current);

  return (
    <div className="relative">
      <PopoverList
        label={active?.name ?? t("switcher.label")}
        options={projects.map((p) => ({
          id: p.slug,
          href: `/p/${p.slug}`,
          label: p.name,
          selected: p.slug === current,
        }))}
        filter={(option, needle) => option.label.toLowerCase().includes(needle)}
        placeholder={t("switcher.placeholder")}
        empty={t("switcher.empty")}
      />
    </div>
  );
}
