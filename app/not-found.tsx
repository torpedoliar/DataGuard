import Link from "next/link";
import { ArrowLeft, FileQuestion, LayoutDashboard } from "lucide-react";

/** Root-level fallback for unmatched paths, including locale-prefixed URLs. */
export default function NotFound() {
  return (
    <main id="main-content" className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ops-bg px-5 py-12 text-ops-text">
      <div aria-hidden className="ops-grid-bg pointer-events-none absolute inset-0" />
      <section className="relative w-full max-w-md animate-enter text-center">
        <div className="mx-auto mb-6 flex size-12 items-center justify-center rounded-xl border border-ops-border bg-ops-surface text-ops-muted shadow-[var(--shadow-raised)]">
          <FileQuestion className="size-5" aria-hidden />
        </div>
        <p className="font-mono text-xs font-medium tracking-widest text-ops-accent">404 / NOT FOUND</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">This page isn&apos;t here</h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-ops-muted">
          The link may have moved, or you may not have access to this workspace.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Link href="/checklist" className="inline-flex h-9 items-center gap-2 rounded-md bg-ops-accent px-3.5 text-sm font-medium text-ops-accent-fg transition-[background-color,transform] hover:bg-ops-accent-hover active:scale-[0.98]">
            <LayoutDashboard className="size-4" aria-hidden />
            Go to dashboard
          </Link>
          <Link href="/select-site" className="inline-flex h-9 items-center gap-2 rounded-md border border-ops-border-strong bg-ops-surface px-3.5 text-sm font-medium text-ops-text transition-colors hover:bg-ops-surface-raised">
            <ArrowLeft className="size-4" aria-hidden />
            Choose a site
          </Link>
        </div>
      </section>
    </main>
  );
}
