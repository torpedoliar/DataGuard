"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search } from "lucide-react";
import clsx from "clsx";

export type CommandItem = {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hint?: string;
  keywords?: string;
  run: () => void;
};

/**
 * ⌘K / Ctrl+K launcher over the app navigation and a few global actions.
 * Fully keyboard driven: arrows move, Enter runs, Esc closes.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  items,
  placeholder,
  emptyLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder: string;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          setQuery("");
          setActive(0);
        }
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.group} ${item.keywords ?? ""}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open || typeof document === "undefined") return null;

  const close = () => {
    setQuery("");
    setActive(0);
    onOpenChange(false);
  };

  const run = (item: CommandItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const groups: { name: string; entries: { item: CommandItem; index: number }[] }[] = [];
  filtered.forEach((item, index) => {
    const group = groups.find((g) => g.name === item.group);
    if (group) group.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={placeholder}
        className="w-full max-w-xl animate-scale-in overflow-hidden rounded-xl border border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)]"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Tab") {
            // The search field is the only focusable control in this dialog.
            event.preventDefault();
            inputRef.current?.focus();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((value) => (filtered.length ? (value + 1) % filtered.length : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => (filtered.length ? (value - 1 + filtered.length) % filtered.length : 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            run(filtered[active]);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-ops-border px-4">
          <Search className="size-4 shrink-0 text-ops-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
            className="ops-bare-input h-12 w-full border-0 bg-transparent text-[15px] text-ops-text shadow-none outline-none placeholder:text-ops-subtle"
          />
          <kbd className="hidden shrink-0 rounded border border-ops-border bg-ops-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-ops-muted sm:block">Esc</kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-8 text-center text-sm text-ops-muted">{emptyLabel}</p>}
          {groups.map((group) => (
            <div key={group.name} className="pb-1">
              <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-ops-subtle">{group.name}</p>
              {group.entries.map(({ item, index }) => (
                <div
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(item)}
                  className={clsx(
                    "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm transition-colors [&_svg]:size-4",
                    index === active ? "bg-ops-surface-raised text-ops-text" : "text-ops-muted",
                  )}
                >
                  <span className={clsx("shrink-0", index === active ? "text-ops-accent" : "text-ops-subtle")}>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 text-xs text-ops-subtle">{item.hint}</span>}
                  {index === active && <CornerDownLeft className="shrink-0 text-ops-subtle" aria-hidden />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
