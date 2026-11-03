"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type ModalEntry = {
  token: object;
  close: () => void;
  canDismiss: () => boolean;
};

// One document listener and an explicit stack ensure Escape closes only the
// topmost custom overlay (nested dialogs must not all disappear at once).
const modalStack: ModalEntry[] = [];
let previousBodyOverflow: string | null = null;

function removeModal(token: object) {
  const index = modalStack.findIndex((entry) => entry.token === token);
  if (index < 0) return;
  modalStack.splice(index, 1);

  if (modalStack.length === 0) {
    document.removeEventListener("keydown", handleModalKeyDown);
    if (previousBodyOverflow !== null) {
      document.body.style.overflow = previousBodyOverflow;
      previousBodyOverflow = null;
    }
  }
}

function handleModalKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || modalStack.length === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const top = modalStack[modalStack.length - 1];
  if (top.canDismiss()) top.close();
}

/**
 * Dismiss contract for custom full-screen overlays that do not use the Modal
 * primitive. Escape closes only the topmost overlay and body scrolling stays
 * locked until the last stacked overlay closes.
 */
export function useDismissOnEscape(onClose: () => void, enabled = true, canDismiss = true) {
  const tokenRef = useRef<object>({});
  const closeRef = useRef(onClose);
  const canDismissRef = useRef(canDismiss);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    canDismissRef.current = canDismiss;
  }, [onClose, canDismiss]);

  useEffect(() => {
    if (!enabled) return;
    const token = tokenRef.current;
    if (modalStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleModalKeyDown);
    }
    modalStack.push({
      token,
      close: () => closeRef.current(),
      canDismiss: () => canDismissRef.current,
    });
    return () => removeModal(token);
  }, [enabled]);
}

/** Locks body scroll without registering Escape behavior. Prefer useModalDismiss. */
export function useScrollLock(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const token = {};
    if (modalStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    modalStack.push({ token, close: () => {}, canDismiss: () => false });
    return () => removeModal(token);
  }, [enabled]);
}

/** Convenience: Escape-to-close plus body scroll lock for one overlay. */
export function useModalDismiss(onClose: () => void, enabled = true, canDismiss = true) {
  useDismissOnEscape(onClose, enabled, canDismiss);
}
