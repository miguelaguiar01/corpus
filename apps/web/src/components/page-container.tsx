import type { ReactNode } from "react";

const WIDTH = {
  form: "max-w-md",
  reading: "max-w-2xl",
  wide: "max-w-6xl",
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
      className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${WIDTH[width]} ${className}`}
    >
      {children}
    </main>
  );
}
