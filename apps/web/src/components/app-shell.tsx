import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { AppNav } from "./app-nav";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";

// The one shell (docs/design.md): wordmark, the project switcher and nav
// when there is a project, and the page below. The header wraps on a
// phone; four links beside the switcher overflow 390px, and a page that
// overflows sideways breaks fixed-bar hit testing.
export function AppShell({
  project,
  maintainer = false,
  projects = [],
  children,
}: {
  project?: string;
  maintainer?: boolean;
  projects?: ProjectOption[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2 sm:px-6 lg:px-8">
        <Link href="/" className="text-sm font-semibold">
          {t("app.title")}
        </Link>
        {project && <ProjectSwitcher current={project} projects={projects} />}
        {project && (
          <div className="ml-auto">
            <AppNav slug={project} maintainer={maintainer} />
          </div>
        )}
      </header>
      {children}
    </div>
  );
}
