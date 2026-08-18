/**
 * Route-level loading placeholder for every page under /<locale>/(dashboard).
 * Rendered while the server segment (and its slow admin/dashboard queries)
 * streams — a small generic skeleton matching the dashboard layout.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
      <div>
        <div className="h-4 w-28 animate-pulse rounded bg-ops-border" />
        <div className="mt-2 h-7 w-64 animate-pulse rounded bg-ops-border" />
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-md border border-ops-border bg-ops-surface p-3"
          >
            <div className="h-8 w-8 animate-pulse rounded bg-ops-border" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-ops-border" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-ops-border" />
          </div>
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-md border border-ops-border bg-ops-surface" />
    </div>
  );
}