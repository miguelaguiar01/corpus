import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// chipVariants for links and buttons that look like chips; only the
// state variants carry colour (docs/design.md).
export const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-secondary-foreground",
        outline: "border border-border text-muted-foreground",
        solid: "bg-primary text-primary-foreground",
        key: "bg-muted font-mono text-muted-foreground",
        "state-verified": "bg-state-verified text-state-verified-foreground",
        "state-stale": "bg-state-stale text-state-stale-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Chip({
  variant,
  className,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return (
    <span className={cn(chipVariants({ variant }), className)} {...props} />
  );
}
