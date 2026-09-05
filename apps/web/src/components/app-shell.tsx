import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/auth/actions";
import { t } from "@/i18n";
import { AppNav } from "./app-nav";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";

// The header wraps on a phone: four links beside the switcher overflow
// 390px, and a page that overflows sideways breaks fixed-bar hit testing.
export function AppShell({
  project,
  maintainer = false,
  projects = [],
  home = true,
  signedIn = home,
  children,
}: {
  project?: string;
  maintainer?: boolean;
  projects?: ProjectOption[];
  // False on the invite page: a visitor without a session has nowhere
  // to go, and a prefetched link home would only be redirected back.
  home?: boolean;
  // The sign-out control; on by default wherever the wordmark links home,
  // and set alone on the page that holds a session but no home yet.
  signedIn?: boolean;
  children: ReactNode;
}) {
  const wordmark = "text-sm font-semibold";
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2 sm:px-6 lg:px-8">
        {home ? (
          <Link href="/" className={wordmark}>
            {t("app.title")}
          </Link>
        ) : (
          <span className={wordmark}>{t("app.title")}</span>
        )}
        {project && <ProjectSwitcher current={project} projects={projects} />}
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
          {project && <AppNav slug={project} maintainer={maintainer} />}
          {signedIn && (
            <form action={signOut}>
              <button
                type="submit"
                className="-mb-px border-b-2 border-transparent py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {t("nav.signOut")}
              </button>
            </form>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
