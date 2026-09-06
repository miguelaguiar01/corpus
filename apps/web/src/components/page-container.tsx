import type { ReactNode } from "react";

// form: one column of fields; reading: text and settings; wide: lists,
// grids and two panes, which grow with the display up to 100rem. The
// gutters match the shell's header so content and chrome share edges.
const WIDTH = {
  form: "max-w-md",
  reading: "max-w-3xl",
  wide: "max-w-[100rem]",
} as const;

export function Page({
  width,
  className = "",
  children,
}: {
  width: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8 2xl:px-16 ${WIDTH[width]} ${className}`}
    >
      {children}
    </main>
  );
}
