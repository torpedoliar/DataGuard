/**
 * Route-level loading placeholder for every page under /<locale>/(dashboard).
 * Rendered while the server segment (and its slow admin/dashboard queries)
 * streams — a small generic skeleton matching the dashboard layout.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8" aria-busy="true" aria-live="polite">
      <div>
        <div className="skeleton h-3.5 w-32" />
        <div className="skeleton mt-2.5 h-6 w-72" />
        <div className="skeleton mt-2 h-3.5 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="ops-panel space-y-3 p-4">
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton h-7 w-16" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        ))}
      </div>
      <div className="ops-panel space-y-3 p-4">
        <div className="skeleton h-4 w-40" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-8 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
