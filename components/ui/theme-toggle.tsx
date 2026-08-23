"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    /* storage blocked (private mode) — session-only theme */
  }
}

// Reads the live theme off <html class> so an external writer (app-shell
// applyTheme on load) re-renders the icon without any effect.
const themeStore = {
  subscribe(listener: () => void) {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  },
  getSnapshot: () => document.documentElement.classList.contains("dark"),
  // Server/first paint placeholder: renders the empty spacer until hydrated,
  // keeping SSR and client output identical.
  getServerSnapshot: () => null as boolean | null,
};

export function ThemeToggle() {
  const dark = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        // applyTheme mutates <html class>; the MutationObserver in themeStore
        // feeds it back through useSyncExternalStore — no local state.
        applyTheme(!(dark ?? true));
      }}
      className="p-2 rounded-md text-ops-muted hover:text-ops-text hover:bg-ops-surface-raised transition-colors"
    >
      {dark === null ? (
        <span className="block w-5 h-5" />
      ) : dark ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}
