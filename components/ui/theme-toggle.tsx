"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  const mode = dark ? "dark" : "light";
  try {
    localStorage.setItem("theme", mode);
  } catch {
    /* storage blocked (private mode) — session-only theme */
  }
  try {
    document.cookie = `theme=${mode}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* cookie blocked */
  }
}

// Reads the live theme off <html class> and listens to cross-tab storage events
// so any tab or external writer re-renders the icon synchronously.
const themeStore = {
  subscribe(listener: () => void) {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const onStorage = (e: StorageEvent) => {
      if (e.key === "theme" && e.newValue) {
        const isDark = e.newValue === "dark";
        document.documentElement.classList.toggle("dark", isDark);
        try {
          document.cookie = `theme=${e.newValue}; path=/; max-age=31536000; SameSite=Lax`;
        } catch {
          /* ignore */
        }
        listener();
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot: () => document.documentElement.classList.contains("dark"),
  // Server/first paint placeholder: renders the empty spacer until hydrated,
  // keeping SSR and client output identical.
  getServerSnapshot: () => null as boolean | null,
};

export function ThemeToggle() {
  const dark = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getServerSnapshot);

  // Fallback to reading DOM directly if dark is still null (e.g. click before hydration)
  const isDark =
    dark !== null
      ? dark
      : typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : true;

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        applyTheme(!isDark);
      }}
      className="p-2 rounded-md text-ops-muted hover:text-ops-text hover:bg-ops-surface-raised transition-colors"
    >
      {dark === null ? (
        <span className="block w-5 h-5" />
      ) : isDark ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}
