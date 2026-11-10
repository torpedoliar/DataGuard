"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Loader2, Search, ShieldAlert, TriangleAlert, X } from "lucide-react";
import clsx from "clsx";
import ActionButton from "@/components/ui/action-button";
import {
  linkEpdrEndpointToAsset,
  searchSiteAssets,
  setEpdrEndpointCritical,
  setEpdrEndpointNoAuto,
  unlinkEpdrEndpoint,
  type EpdrEndpointRow,
} from "@/actions/epdr-endpoints";
import { useModalDismiss } from "@/components/ui/use-modal-dismiss";
import { SERVER_DEVICE_TYPE } from "@/lib/epdr/posture";

const TONES: Record<string, { dot: string; text: string; border: string; bg: string }> = {
  protected: { dot: "bg-ops-success", text: "text-ops-success", border: "border-ops-success/25", bg: "bg-ops-success-soft" },
  outdated: { dot: "bg-ops-success/45", text: "text-ops-success", border: "border-ops-success/25", bg: "bg-ops-success-soft" },
  disabled: { dot: "bg-ops-danger", text: "text-ops-danger", border: "border-ops-danger/25", bg: "bg-ops-danger-soft" },
  error: { dot: "bg-ops-orange", text: "text-ops-orange", border: "border-ops-orange/25", bg: "bg-ops-orange-soft" },
  install_error: { dot: "bg-ops-warning", text: "text-ops-warning", border: "border-ops-warning/25", bg: "bg-ops-warning-soft" },
  no_license: { dot: "bg-ops-info", text: "text-ops-info", border: "border-ops-info/25", bg: "bg-ops-info-soft" },
  unknown: { dot: "bg-ops-subtle", text: "text-ops-muted", border: "border-ops-border", bg: "bg-ops-surface-raised" },
};

function relative(date: Date | null, locale: string): string {
  if (!date) return "—";
  const diffSec = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ops-border/60 py-2 last:border-0">
      <dt className="shrink-0 text-[13px] text-ops-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] text-ops-text">{children}</dd>
    </div>
  );
}

/** Toggle that writes through a server action; shows pending and error inline. */
function SettingToggle({
  label,
  hint,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onToggle: (next: boolean) => Promise<{ message?: string } | undefined>;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ops-text">{label}</p>
        <p className="mt-0.5 text-[12px] text-ops-muted">{hint}</p>
        {error && <p className="mt-1 text-[12px] text-ops-danger">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await onToggle(!checked);
            if (res && "message" in res && res.message) setError(res.message);
            else router.refresh();
          })
        }
        className={clsx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-50",
          checked ? "border-ops-accent bg-ops-accent" : "border-ops-border-strong bg-ops-surface-sunken",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 size-[1.125rem] rounded-full bg-white shadow-sm transition-all duration-150 ease-out",
            checked ? "left-[calc(100%-1.25rem)]" : "left-0.5",
          )}
        />
        {pending && <Loader2 className="absolute -left-6 top-1 size-4 animate-spin text-ops-muted" aria-hidden />}
      </button>
    </div>
  );
}

/** Search + link the endpoint to a DataGuard asset in the same site. */
function AssetLinker({ endpointId, assetName }: { endpointId: number; assetName: string | null }) {
  const t = useTranslations("Epdr");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: number; name: string; ipAddress: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const seq = ++searchSeq.current;
    const handle = setTimeout(async () => {
      if (term.trim().length < 2) {
        setResults([]);
        return;
      }
      const found = await searchSiteAssets(term);
      if (seq === searchSeq.current) setResults(found);
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);

  const run = (action: (state: null, form: FormData) => Promise<{ message?: string; success?: boolean }>, form: FormData) =>
    startTransition(async () => {
      setError(null);
      const res = await action(null, form);
      if (res.message && !res.success) setError(res.message);
      else {
        setTerm("");
        setResults([]);
        router.refresh();
      }
    });

  if (assetName) {
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 className="size-4 shrink-0 text-ops-success" aria-hidden />
          <span className="truncate text-[13px] font-medium text-ops-text">{assetName}</span>
        </div>
        <ActionButton
          variant="secondary"
          size="sm"
          isPending={pending}
          onClick={() => {
            const form = new FormData();
            form.set("endpointId", String(endpointId));
            void run(unlinkEpdrEndpoint, form);
          }}
        >
          {t("drawer.unlink")}
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="py-3">
      <label className="relative block">
        <span className="sr-only">{t("drawer.assetSearch")}</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ops-subtle" aria-hidden />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("drawer.assetSearch")}
          className="ops-input h-9 w-full pl-8 pr-3 text-[13px]"
        />
      </label>
      {error && <p className="mt-1 text-[12px] text-ops-danger">{error}</p>}
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-ops-border overflow-hidden rounded-md border border-ops-border">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 bg-ops-surface px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ops-text">{r.name}</span>
                {r.ipAddress && <span className="block font-mono text-[11.5px] text-ops-subtle">{r.ipAddress}</span>}
              </span>
              <ActionButton
                variant="secondary"
                size="sm"
                isPending={pending}
                onClick={() => {
                  const form = new FormData();
                  form.set("endpointId", String(endpointId));
                  form.set("deviceId", String(r.id));
                  void run(linkEpdrEndpointToAsset, form);
                }}
              >
                {t("drawer.link")}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EndpointDrawer({
  endpoint,
  isAdmin,
  locale,
  onClose,
}: {
  endpoint: EpdrEndpointRow | null;
  isAdmin: boolean;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("Epdr");
  useModalDismiss(() => onClose(), endpoint !== null);

  if (!endpoint) return null;

  const tone = TONES[endpoint.bucket] ?? TONES.unknown!;
  const typeKey = endpoint.deviceType && [1, 2, 3, 4].includes(endpoint.deviceType) ? String(endpoint.deviceType) : "unknown";

  const toggle = (action: typeof setEpdrEndpointCritical, value: boolean) => async () => {
    const form = new FormData();
    form.set("endpointId", String(endpoint.id));
    form.set("value", String(value));
    return (await action(null, form)) as { message?: string };
  };

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} role="presentation" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("drawer.details")}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-ops-border bg-ops-surface shadow-[var(--shadow-overlay)] motion-safe:animate-slide-in-right"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ops-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ops-text">{endpoint.hostName}</h2>
            <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ops-muted">
              {t(`deviceType.${typeKey}`)}
              {endpoint.ipAddress && <span className="font-mono text-ops-subtle">{endpoint.ipAddress}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("drawer.close")}
            className="shrink-0 rounded-md p-1.5 text-ops-muted transition-colors hover:bg-ops-surface-raised hover:text-ops-text"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Status + the plain-language next step. */}
          <div className={clsx("rounded-lg border px-4 py-3.5", tone.border, tone.bg)}>
            <p className={clsx("flex items-center gap-2 text-sm font-semibold", tone.text)}>
              <span className={clsx("size-2 rounded-full", tone.dot)} aria-hidden />
              {t(`bucket.${endpoint.bucket}`)}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ops-text">{t(`bucketHint.${endpoint.bucket}`)}</p>
          </div>

          <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-ops-muted">{t("drawer.whatToDo")}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ops-text">{t(`drawer.nextStep.${endpoint.bucket}`)}</p>

          {!(endpoint.deviceType === SERVER_DEVICE_TYPE || endpoint.isCritical) && endpoint.rebootRequested && (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-ops-warning/25 bg-ops-warning-soft px-3 py-2.5 text-[13px] text-ops-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("drawer.restart")}: {t("drawer.yes")}
            </p>
          )}

          <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-ops-muted">{t("drawer.details")}</h3>
          <dl className="mt-1">
            <Row label={t("drawer.ip")}>{endpoint.ipAddress ?? "—"}</Row>
            <Row label={t("drawer.os")}>{endpoint.operatingSystem ?? "—"}</Row>
            <Row label={t("drawer.group")}>{endpoint.groupPath ?? "—"}</Row>
            <Row label={t("drawer.agent")}>{endpoint.agentVersion ?? "—"}</Row>
            <Row label={t("drawer.lastSeen")}>{relative(endpoint.lastConnectionAt, locale)}</Row>
            <Row label={t("drawer.lastSync")}>{relative(endpoint.lastSyncedAt, locale)}</Row>
            <Row label={t("drawer.restart")}>{endpoint.rebootRequested ? t("drawer.yes") : t("drawer.no")}</Row>
            <Row label={t("drawer.rawStatus")}>
              <span className="font-mono">{endpoint.accumulatedProtectionStatus ?? "—"}</span>
            </Row>
          </dl>

          <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-ops-muted">{t("drawer.settings")}</h3>
          {!isAdmin && (
            <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-ops-muted">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              {t("drawer.readOnlyNote")}
            </p>
          )}
          <div className="mt-1 divide-y divide-ops-border">
            <SettingToggle
              label={t("drawer.critical")}
              hint={t("drawer.criticalHint")}
              checked={endpoint.isCritical}
              disabled={!isAdmin}
              onToggle={toggle(setEpdrEndpointCritical, !endpoint.isCritical)}
            />
            <SettingToggle
              label={t("drawer.noAuto")}
              hint={t("drawer.noAutoHint")}
              checked={endpoint.noAuto}
              disabled={!isAdmin}
              onToggle={toggle(setEpdrEndpointNoAuto, !endpoint.noAuto)}
            />
          </div>

          <h3 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-ops-muted">{t("drawer.asset")}</h3>
          {isAdmin ? (
            <>
              <p className="mt-1.5 text-[12.5px] text-ops-muted">{t("drawer.assetHint")}</p>
              <AssetLinker endpointId={endpoint.id} assetName={endpoint.assetName} />
            </>
          ) : (
            <p className="mt-1.5 text-[13px] text-ops-text">{endpoint.assetName ?? t("endpoints.unlinked")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
