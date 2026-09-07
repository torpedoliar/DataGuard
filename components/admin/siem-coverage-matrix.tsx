"use client";

import { ATTACK_TACTIC_INFO, ATTACK_TECHNIQUE_INFO, ISO_CONTROL_INFO } from "@/lib/siem/coverage-reference";
import { X } from "lucide-react";
import { useState } from "react";

export type SiemCoverageRule = {
  name: string;
  description?: string;
  category?: string;
  enabled: boolean;
  techniques?: string[];
};

export type SiemCoverageEntry = {
  tactic?: string;
  control: string;
  covered: boolean;
  ruleCount: number;
  enabledCount: number;
  rules: SiemCoverageRule[];
};

export type SiemCoverageMatrix = {
  tactics: {
    tactic: string;
    covered: boolean;
    ruleCount: number;
    enabledCount: number;
    rules: SiemCoverageRule[];
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

function Tile({ label, covered, count, onClick }: { label: string; covered: boolean; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-center transition-colors hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-blue-400/60 ${
        covered
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-slate-700 bg-slate-800/60 text-slate-500 hover:text-slate-300"
      }`}
    >
      <div className="truncate text-[11px] font-medium leading-tight">{label}</div>
      <div className="text-[10px] leading-tight opacity-75">{count} rule{count === 1 ? "" : "s"}</div>
    </button>
  );
}

function techniqueChips(techniques: string[] | undefined) {
  if (!techniques || techniques.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {techniques.map((technique) => {
        const info = ATTACK_TECHNIQUE_INFO[technique];
        return (
          <span key={technique} title={info ? `${technique} — ${info.name}` : technique} className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 font-mono text-[10px] text-purple-300">
            {technique}
          </span>
        );
      })}
    </div>
  );
}

function RuleListItem({ rule }: { rule: SiemCoverageRule }) {
  return (
    <li className="rounded border border-slate-700/60 bg-slate-900/60 p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">{rule.name}</span>
        <span className={`rounded-full border px-1.5 py-px text-[10px] ${rule.enabled ? "border-emerald-500/40 text-emerald-300" : "border-slate-600 text-slate-500"}`}>
          {rule.enabled ? "aktif" : "mati"}
        </span>
        {rule.category && <span className="text-[10px] uppercase tracking-wide text-slate-500">{rule.category}</span>}
      </div>
      {rule.description && <p className="mt-1 text-xs text-slate-400">{rule.description}</p>}
      {techniqueChips(rule.techniques)}
    </li>
  );
}

type Selection = { kind: "tactic"; tactic: string } | { kind: "control"; control: string } | null;

export default function SiemCoverageMatrixPanel({ matrix }: { matrix: SiemCoverageMatrix }) {
  const { stats } = matrix;
  const [selected, setSelected] = useState<Selection>(null);

  const tacticEntry = selected?.kind === "tactic" ? matrix.tactics.find((entry) => entry.tactic === selected.tactic) : undefined;
  const tacticInfo = selected?.kind === "tactic" ? ATTACK_TACTIC_INFO[selected.tactic] : undefined;
  const controlEntry = selected?.kind === "control" ? matrix.isoControls.find((entry) => entry.control === selected.control) : undefined;
  const controlInfo = selected?.kind === "control" ? ISO_CONTROL_INFO[selected.control] : undefined;

  // Distinct techniques mapped to the selected tactic across its rules.
  const tacticTechniques = tacticEntry
    ? [...new Set(tacticEntry.rules.flatMap((rule) => rule.techniques ?? []))]
    : [];

  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">MITRE ATT&amp;CK &amp; ISO 27001 Coverage</h2>
        <span className="text-xs text-slate-400">
          {stats.tacticsCovered}/{matrix.tactics.length} tactics · {stats.attackMappedEnabled}/{stats.totalRules} rules mapped &amp; enabled
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Klik kotak untuk melihat detail tactic/kontrol dan rule yang memetakannya. Ubah pemetaan di halaman Rules (Edit rule).
      </p>

      <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-7">
        {matrix.tactics.map((entry) => (
          <Tile
            key={entry.tactic}
            label={TACTIC_LABEL[entry.tactic] ?? entry.tactic}
            covered={entry.covered}
            count={entry.enabledCount}
            onClick={() => setSelected({ kind: "tactic", tactic: entry.tactic })}
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
                onClick={() => setSelected({ kind: "control", control: entry.control })}
              />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-ops-border bg-ops-surface-raised shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-ops-border px-5 py-4">
              <div>
                {selected.kind === "tactic" ? (
                  <>
                    <p className="font-mono text-[11px] uppercase tracking-wide text-purple-300">
                      {tacticInfo?.id ?? "MITRE ATT&CK"} · {selected.tactic}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-ops-text">{selected.tactic}</h3>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[11px] uppercase tracking-wide text-sky-300">
                      ISO/IEC 27001:2022 Annex A · {selected.control}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-ops-text">
                      {controlInfo ? `${controlInfo.id} — ${controlInfo.title}` : selected.control}
                    </h3>
                  </>
                )}
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-md p-1 text-ops-muted hover:bg-ops-surface hover:text-ops-text">
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <p className="text-sm leading-relaxed text-ops-muted">
                {selected.kind === "tactic"
                  ? (tacticInfo?.description ?? "Tactic MITRE ATT&CK.")
                  : (controlInfo?.description ?? "Kontrol ISO 27001 Annex A.")}
              </p>

              {selected.kind === "tactic" && tacticInfo && (
                <a href={tacticInfo.url} target="_blank" rel="noreferrer" className="inline-block text-xs text-blue-400 hover:text-blue-300">
                  Lihat di attack.mitre.org ↗
                </a>
              )}

              {selected.kind === "tactic" && tacticTechniques.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Teknik yang terpetakan ({tacticTechniques.length})</h4>
                  <ul className="mt-2 space-y-1">
                    {tacticTechniques.map((technique) => {
                      const info = ATTACK_TECHNIQUE_INFO[technique];
                      return (
                        <li key={technique} className="text-xs text-ops-text">
                          <a href={info?.url ?? `https://attack.mitre.org/techniques/${technique.split(".")[0]}/`} target="_blank" rel="noreferrer" className="font-mono text-purple-300 hover:text-purple-200">
                            {technique}
                          </a>
                          {info && <span className="ml-2 text-ops-muted">{info.name}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ops-muted">
                  Rule yang memetakan ({(selected.kind === "tactic" ? tacticEntry?.rules.length : controlEntry?.rules.length) ?? 0})
                </h4>
                {(selected.kind === "tactic" ? tacticEntry?.rules : controlEntry?.rules)?.length ? (
                  <ul className="mt-2 space-y-2">
                    {(selected.kind === "tactic" ? tacticEntry!.rules : controlEntry!.rules).map((rule) => (
                      <RuleListItem key={rule.name} rule={rule} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ops-muted">
                    Belum ada rule yang memetakan ini. Tambahkan pemetaan di halaman Rules (Edit rule).
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
