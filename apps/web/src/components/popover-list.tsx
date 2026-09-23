"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PopoverOption = {
  id: string;
  href: string;
  label: string;
  selected: boolean;
};

// One popover shape for the language picker and the project switcher
// (#488): a control that opens a filter and a list of links. Escape
// closes and returns focus to the control, a pointer-down outside
// closes, ArrowDown and ArrowUp move a highlight through the filtered
// options and Enter follows it. The filter input sits outside the
// listbox and names it with aria-controls, so the listbox holds options
// alone and the highlight is the input's aria-activedescendant.
export function PopoverList({
  label,
  options,
  filter,
  placeholder,
  empty,
  controlVariant = "outline",
  controlClassName,
  listClassName,
}: {
  label: ReactNode;
  options: PopoverOption[];
  filter: (option: PopoverOption, needle: string) => boolean;
  placeholder: string;
  empty: string;
  controlVariant?: "outline" | "ghost";
  controlClassName?: string;
  listClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const control = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) => filter(option, needle));
  const current = shown[Math.min(highlighted, shown.length - 1)];

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (focusControl: boolean) => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
    if (focusControl) control.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      close(false);
      router.push(current.href);
    }
  };

  return (
    <div ref={root} className="contents">
      <Button
        ref={control}
        variant={controlVariant}
        size="sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={controlClassName}
      >
        {label}
      </Button>
      {open && (
        <div
          className={`absolute left-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md ${listClassName ?? "w-64"}`}
        >
          <Input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-controls={listId}
            aria-expanded={true}
            aria-activedescendant={
              current ? `${listId}-${current.id}` : undefined
            }
            className="mb-1"
          />
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{empty}</p>
          ) : (
            <div
              role="listbox"
              id={listId}
              className="max-h-72 overflow-y-auto"
            >
              {shown.map((option, index) => (
                <Link
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  href={option.href}
                  role="option"
                  aria-selected={option.selected}
                  data-highlighted={
                    index === Math.min(highlighted, shown.length - 1)
                  }
                  onClick={() => close(false)}
                  onPointerMove={() => setHighlighted(index)}
                  className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground aria-selected:font-medium data-[highlighted=true]:bg-accent data-[highlighted=true]:text-accent-foreground"
                >
                  {option.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
