"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2, Send, Bell, BellOff } from "lucide-react";
import { getSiteTelegramChats, addSiteTelegramChat, removeSiteTelegramChat, toggleSiteTelegramChat } from "@/actions/sites";
import ActionButton from "@/components/ui/action-button";

type SiteTelegramChat = {
    id: number;
    siteId: number;
    chatId: string;
    label: string;
    severityFilter: string | null;
    enabled: boolean | null;
    createdAt: Date | null;
};

const SEVERITY_OPTIONS = ["Low", "Medium", "High", "Critical"] as const;

export default function SiteTelegramChats({ siteId }: { siteId: number }) {
    const [chats, setChats] = useState<SiteTelegramChat[]>([]);
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [formChatId, setFormChatId] = useState("");
    const [formLabel, setFormLabel] = useState("");
    const [formSeverities, setFormSeverities] = useState<string[]>([]);
    const [useFilter, setUseFilter] = useState(false);

    const load = () => {
        startTransition(async () => {
            const data = await getSiteTelegramChats(siteId);
            setChats((data as SiteTelegramChat[]) ?? []);
        });
    };

    useEffect(() => {
        if (siteId) load();
    }, [siteId]);

    const toggleSeverity = (sev: string) => {
        setFormSeverities((prev) => (prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]));
    };

    const handleAdd = () => {
        setError(null);
        setSuccess(null);
        if (!formChatId.trim() || !formLabel.trim()) {
            setError("Chat ID dan Label wajib diisi.");
            return;
        }
        const severityFilter = useFilter && formSeverities.length > 0 ? formSeverities.join(",") : null;
        startTransition(async () => {
            const res = await addSiteTelegramChat(siteId, formChatId.trim(), formLabel.trim(), severityFilter);
            if (res.success) {
                setSuccess(res.message || "Berhasil");
                setFormChatId("");
                setFormLabel("");
                setFormSeverities([]);
                setUseFilter(false);
                load();
            } else {
                setError(res.message || "Gagal menambah chat");
            }
        });
    };

    const handleRemove = (id: number) => {
        if (!confirm("Hapus chat ini?")) return;
        setError(null);
        startTransition(async () => {
            const res = await removeSiteTelegramChat(id);
            if (res.success) {
                setSuccess(res.message || "Berhasil");
                load();
            } else {
                setError(res.message || "Gagal menghapus");
            }
        });
    };

    const handleToggle = (id: number, enabled: boolean) => {
        setError(null);
        startTransition(async () => {
            const res = await toggleSiteTelegramChat(id, enabled);
            if (!res.success) setError(res.message || "Gagal");
            load();
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Send aria-hidden="true" className="size-4 text-ops-info" />
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ops-text">Multi-recipient Telegram</h3>
            </div>
            <p className="text-[13px] text-ops-muted">
                Opsional. Jika dikosongkan, fallback ke kolom <code className="rounded-sm bg-ops-surface-raised px-1 font-mono text-xs">telegram_chat_id</code> di tabel site.
                Severity filter kosong = semua severity akan diterima.
            </p>

            {error && <div className="rounded-md border border-ops-danger/25 bg-ops-danger-soft px-3 py-2.5 text-[13px] text-ops-danger">{error}</div>}
            {success && <div className="rounded-md border border-ops-success/25 bg-ops-success-soft px-3 py-2.5 text-[13px] text-ops-success">{success}</div>}

            <div className="space-y-2">
                {chats.length === 0 ? (
                    <p className="py-2 text-sm text-ops-muted">Belum ada multi-recipient. Tambahkan chat di bawah.</p>
                ) : (
                    chats.map((chat) => (
                        <div key={chat.id} className="ops-panel-subtle flex items-center justify-between p-3">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-ops-text">{chat.label}</span>
                                    {!chat.enabled && <span className="rounded-sm bg-ops-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-ops-subtle">disabled</span>}
                                </div>
                                <div className="truncate font-mono text-xs text-ops-subtle">{chat.chatId}</div>
                                <div className="mt-0.5 text-[11px] text-ops-muted">
                                    {chat.severityFilter ? `Severities: ${chat.severityFilter}` : "All severities"}
                                </div>
                            </div>
                            <div className="ml-2 flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => handleToggle(chat.id, !chat.enabled)}
                                    disabled={isPending}
                                    className="rounded-md p-1.5 text-ops-subtle transition-colors hover:bg-ops-surface-sunken hover:text-ops-text disabled:pointer-events-none disabled:opacity-55"
                                    title={chat.enabled ? "Disable" : "Enable"}
                                    aria-label={chat.enabled ? "Disable chat" : "Enable chat"}
                                >
                                    {chat.enabled ? <Bell aria-hidden="true" className="size-3.5" /> : <BellOff aria-hidden="true" className="size-3.5" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleRemove(chat.id)}
                                    disabled={isPending}
                                    className="rounded-md p-1.5 text-ops-danger transition-colors hover:bg-ops-danger-soft disabled:pointer-events-none disabled:opacity-55"
                                    title="Hapus"
                                    aria-label="Hapus chat"
                                >
                                    <Trash2 aria-hidden="true" className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="space-y-2 border-t border-ops-border pt-3">
                <h4 className="text-xs font-medium text-ops-muted">Tambah chat</h4>
                <div className="grid gap-2 md:grid-cols-2">
                    <input
                        value={formLabel}
                        onChange={(e) => setFormLabel(e.target.value)}
                        placeholder="Label (e.g. ops, security, mgmt)"
                        aria-label="Label chat"
                        className="ops-input h-9 px-3 text-sm"
                    />
                    <input
                        value={formChatId}
                        onChange={(e) => setFormChatId(e.target.value)}
                        placeholder="Telegram Chat ID"
                        aria-label="Telegram Chat ID"
                        className="ops-input h-9 px-3 font-mono text-sm"
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-ops-muted">
                    <input type="checkbox" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} className="size-4 rounded border-ops-border-strong" />
                    Batasi severity (kosongkan = semua)
                </label>
                {useFilter && (
                    <div className="flex flex-wrap gap-2">
                        {SEVERITY_OPTIONS.map((sev) => (
                            <label key={sev} className={`cursor-pointer rounded-sm border px-2 py-1 text-xs ${formSeverities.includes(sev) ? "border-ops-info/30 bg-ops-info-soft text-ops-info" : "border-ops-border-strong text-ops-muted"}`}>
                                <input type="checkbox" className="hidden" checked={formSeverities.includes(sev)} onChange={() => toggleSeverity(sev)} />
                                {sev}
                            </label>
                        ))}
                    </div>
                )}
                <ActionButton
                    type="button"
                    size="sm"
                    onClick={handleAdd}
                    isPending={isPending}
                    icon={<Plus aria-hidden="true" className="size-3.5" />}
                >
                    Tambah
                </ActionButton>
            </div>
        </div>
    );
}
