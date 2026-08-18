"use client";

import { useCallback, useEffect } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

/**
 * Route-level error boundary for every page under /<locale>/(dashboard).
 * Catches render errors (including uncaught DB failures from server pages) so
 * one failing data source degrades to a recoverable UI instead of Next's
 * default bare 500. `reset()` re-renders the segment from scratch.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  const handleReset = useCallback(() => {
    reset();
  }, [reset]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-ops-border bg-ops-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-ops-danger/10 text-ops-danger">
          <CircleAlert className="size-6" />
        </div>
        <h1 className="text-lg font-bold text-ops-text">Something went wrong</h1>
        <p className="mt-2 text-sm text-ops-muted">
          The page could not be loaded. This can happen during database
          maintenance or a deployment. Try again in a moment.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-ops-muted">Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ops-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-ops-accent/90"
        >
          <RotateCcw className="size-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}