import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Colour means translation state (docs/design.md): warning is the stale
// amber, error is destructive, info and success stay achromatic.
const TONE = {
  info: "bg-muted text-foreground",
  success: "bg-muted font-medium text-foreground",
  warning: "bg-state-stale text-state-stale-foreground",
  error: "border border-destructive/50 text-destructive",
} as const;

export function Banner({
  tone,
  className,
  children,
}: {
  tone: keyof typeof TONE;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md px-3 py-2 text-sm", TONE[tone], className)}
    >
      {children}
    </div>
  );
}
