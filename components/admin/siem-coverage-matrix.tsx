export type SiemCoverageEntry = {
  tactic?: string;
  control: string;
  covered: boolean;
  ruleCount: number;
  enabledCount: number;
  rules: { name: string; enabled: boolean; techniques?: string[] }[];
};

export type SiemCoverageMatrix = {
  tactics: {
    tactic: string;
    covered: boolean;
    ruleCount: number;
    enabledCount: number;
    rules: { name: string; enabled: boolean; techniques: string[] }[];
  }[];
  isoControls: SiemCoverageEntry[];
  stats: {
    totalRules: number;
    attackMappedRules: number;
    attackMappedEnabled: number;
    tacticsCovered: number;
  };
};

const TACTIC_LABEL: Record<string, string> = {
  Reconnaissance: "Recon",
  "Resource Development": "Resource Dev",
  "Initial Access": "Initial Access",
  Execution: "Execution",
  Persistence: "Persistence",
  "Privilege Escalation": "Priv Esc",
  "Defense Evasion": "Defense Evasion",
  "Credential Access": "Cred Access",
  Discovery: "Discovery",
  "Lateral Movement": "Lateral Mvmt",
  Collection: "Collection",
  "Command and Control": "C2",
  Exfiltration: "Exfiltration",
  Impact: "Impact",
};

function Tile({ label, covered, count, title }: { label: string; covered: boolean; count: number; title: string }) {
  return (
    <div
      title={title}
      className={`rounded-md border px-2 py-1.5 text-center ${
        covered
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-slate-700 bg-slate-800/60 text-slate-500"
      }`}
    >
      <div className="truncate text-[11px] font-medium leading-tight">{label}</div>
      <div className="text-[10px] leading-tight opacity-75">{count} rule{count === 1 ? "" : "s"}</div>
    </div>
  );
}

export default function SiemCoverageMatrixPanel({ matrix }: { matrix: SiemCoverageMatrix }) {
  const { stats } = matrix;

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">MITRE ATT&amp;CK &amp; ISO 27001 Coverage</h2>
        <span className="text-xs text-slate-400">
          {stats.tacticsCovered}/{matrix.tactics.length} tactics · {stats.attackMappedEnabled}/{stats.totalRules} rules mapped &amp; enabled
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Hijau = ada rule aktif yang mendeteksi tactic/kontrol tersebut. Ubah pemetaan di halaman Rules (Edit rule).
      </p>

      <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
        {matrix.tactics.map((entry) => (
          <Tile
            key={entry.tactic}
            label={TACTIC_LABEL[entry.tactic] ?? entry.tactic}
            covered={entry.covered}
            count={entry.enabledCount}
            title={`${entry.tactic}: ${entry.rules.map((rule) => `${rule.name}${rule.enabled ? "" : " (off)"}`).join(", ") || "no rules mapped"}`}
          />
        ))}
      </div>

      {matrix.isoControls.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">ISO 27001 Annex A</h3>
          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
            {matrix.isoControls.map((entry) => (
              <Tile
                key={entry.control}
                label={entry.control}
                covered={entry.covered}
                count={entry.enabledCount}
                title={`${entry.control}: ${entry.rules.map((rule) => `${rule.name}${rule.enabled ? "" : " (off)"}`).join(", ")}`}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
