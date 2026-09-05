import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Section({
  heading,
  level = 2,
  meta,
  description,
  className,
  children,
}: {
  heading: string;
  level?: 2 | 3;
  meta?: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section className={cn("space-y-3", className)}>
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <Heading className="text-sm font-medium text-muted-foreground">
            {heading}
          </Heading>
          {meta !== undefined && (
            <span className="text-sm text-muted-foreground">{meta}</span>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
