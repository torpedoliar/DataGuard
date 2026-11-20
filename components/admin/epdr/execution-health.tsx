"use client";

/**
 * Execution health panel at the top of /admin/epdr/approvals (Actions).
 *
 * Refreshes every 20 seconds (statuses change in the worker, not in this tab).
 * It shows counters and the oldest non-terminal requests only — no payloads.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getEpdrExecutionHealth, type ExecutionHealthData } from "@/actions/epdr-execution-health";

const REFRESH_MS = 20_000;

const COUNT_KEYS = [
  "pendingApproval", "queued", "dispatching", "inProgress", "outcomeUnknown",
  "needsReview", "completed", "failed", "cancelled",
] as const;

export default function ExecutionHealth() {
  const t = useTranslations("Epdr.executionHealth");
  const [data, setData] = useState<ExecutionHealthData | null>(null);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const update = () => {
      getEpdrExecutionHealth().then((result) => {
        if (!mounted.current) return;
        if ("code" in result) setFailed(true);
        else { setData(result); setFailed(false); }
      }).catch(() => { if (mounted.current) setFailed(true); });
    };
    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  return <section className="ops-panel flex flex-col gap-3 p-4">
    <h2 className="text-sm font-medium text-ops-text">{t("title")}</h2>
    <p className="text-xs text-ops-muted">{t("hint")}</p>
    {failed && <p role="alert" className="text-sm text-ops-danger">{t("unavailable")}</p>}
    {!data && !failed && <p className="text-xs text-ops-muted">{t("loading")}</p>}

    {data && <div className="grid grid-cols-3 gap-2 text-xs lg:grid-cols-9">
      {COUNT_KEYS.map((key) => <div key={key} className="rounded-md border border-ops-border p-2">
        <p className="text-ops-muted">{t(`counts.${key}` as never)}</p>
        <p className="text-base font-medium text-ops-text">{data.counts[key]}</p>
      </div>)}
    </div>}

    {data && data.stuck.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr className="text-ops-muted">
          <th className="pr-2">#</th>
          <th className="pr-2">{t("action")}</th>
          <th className="pr-2">{t("state")}</th>
          <th className="pr-2">{t("host")}</th>
          <th className="pr-2">{t("age")}</th>
          <th className="pr-2">{t("reason")}</th>
        </tr></thead>
        <tbody>
          {data.stuck.map((row) => <tr key={row.id}>
            <td className="pr-2 text-ops-text">{row.id}</td>
            <td className="pr-2 text-ops-text">{row.actionType}</td>
            <td className="pr-2 text-ops-text">{row.state}</td>
            <td className="pr-2 text-ops-text">{row.hostName ?? "—"}</td>
            <td className="pr-2 text-ops-text">{t("ageMinutes", { minutes: row.ageMinutes })}</td>
            <td className="pr-2 text-ops-text">{row.reason ?? "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </section>;
}
