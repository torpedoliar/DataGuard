"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {
    /* storage blocked (private mode) — session-only theme */
  }
}

export function ThemeToggle() {
  // null until mounted so SSR and first client render match (icon decided client-side)
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const next = !(dark ?? true);
        setDark(next);
        applyTheme(next);
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
