import StatsCard from "@/components/ui/stats-card";
import { type ThreatIntelStats } from "@/lib/threat-intel";
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";

export default function ThreatIntelKpi({ stats }: { stats: ThreatIntelStats }) {
  return (
    <section aria-label="Compliance KPIs" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatsCard
        label="Total Threats Tracked"
        value={stats.total}
        icon={<ShieldAlert className="size-5" />}
        tone="info"
        meta="ISO 27001 A.5.7 Threat Register"
      />
      <StatsCard
        label="Mitigation Rate"
        value={`${stats.mitigationRate}%`}
        icon={<ShieldCheck className="size-5" />}
        tone={stats.mitigationRate >= 80 ? "success" : "warning"}
        meta={`${stats.mitigated + stats.notApplicableOrAccepted} of ${stats.total} mitigated / resolved`}
      />
      <StatsCard
        label="Active Threats"
        value={stats.open + stats.inProgress}
        icon={<AlertTriangle className="size-5" />}
        tone={stats.open + stats.inProgress > 0 ? "danger" : "success"}
        meta={`${stats.open} Open • ${stats.inProgress} In Progress`}
      />
      <StatsCard
        label="Critical / High Severity"
        value={stats.criticalHigh}
        icon={<CheckCircle2 className="size-5" />}
        tone={stats.criticalHigh > 0 ? "danger" : "neutral"}
        meta="Requires immediate remediation"
      />
    </section>
  );
}
