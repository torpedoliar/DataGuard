"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Accessible modal dialog with focus trap and ESC close.
 *
 * - role="dialog" + aria-modal="true" + aria-labelledby wired to the title
 * - Focus is moved into the dialog on open and restored to the opener on close
 * - Tab/Shift+Tab are trapped to focusable descendants
 * - ESC closes the dialog
 * - Click on the backdrop closes the dialog
 */
export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Optional content rendered in the header (right side). */
  headerExtra?: ReactNode;
  /** Hide the built-in close button. Caller is responsible for an alternate dismiss path. */
  hideCloseButton?: boolean;
  /** Tailwind class for the dialog panel. */
  panelClassName?: string;
  /** Tailwind class for the backdrop container. */
  backdropClassName?: string;
  children: ReactNode;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  headerExtra,
  hideCloseButton = false,
  panelClassName = "w-full max-w-md rounded-xl border border-ops-border bg-ops-surface-raised shadow-2xl",
  backdropClassName = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4",
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    const focusables = panel ? getFocusable(panel) : [];
    if (focusables.length > 0) {
      focusables[0].focus();
    } else if (panel) {
      panel.focus();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      const opener = previouslyFocusedRef.current;
      if (opener && typeof opener.focus === "function") {
        opener.focus();
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = getFocusable(panel);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <div
      className={backdropClassName}
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={panelClassName}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ops-border bg-ops-surface px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-ops-text">{title}</h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-xs text-ops-muted">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                title="Close"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent/40"
              >
                <X className="size-4" />
                <span className="sr-only">Close dialog</span>
              </button>
            )}
          </div>
        </div>
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
