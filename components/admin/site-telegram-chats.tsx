"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2, Loader2, Send, Bell, BellOff } from "lucide-react";
import { getSiteTelegramChats, addSiteTelegramChat, removeSiteTelegramChat, toggleSiteTelegramChat } from "@/actions/sites";

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
                <Send className="h-5 w-5 text-blue-500" />
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Multi-Recipient Telegram</h3>
            </div>
            <p className="text-xs text-slate-500">
                Opsional. Jika dikosongkan, fallback ke kolom <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">telegram_chat_id</code> di tabel site.
                Severity filter kosong = semua severity akan diterima.
            </p>

            {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
            {success && <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">{success}</div>}

            <div className="space-y-3">
                {chats.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">Belum ada multi-recipient. Tambahkan chat di bawah.</p>
                ) : (
                    chats.map((chat) => (
                        <div key={chat.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm text-slate-800 dark:text-white">{chat.label}</span>
                                    {!chat.enabled && <span className="text-[10px] px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-500 rounded">disabled</span>}
                                </div>
                                <div className="text-xs font-mono text-slate-500 truncate">{chat.chatId}</div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                    {chat.severityFilter ? `Severities: ${chat.severityFilter}` : "All severities"}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 ml-2">
                                <button
                                    onClick={() => handleToggle(chat.id, !chat.enabled)}
                                    disabled={isPending}
                                    className="p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition"
                                    title={chat.enabled ? "Disable" : "Enable"}
                                >
                                    {chat.enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                    onClick={() => handleRemove(chat.id)}
                                    disabled={isPending}
                                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                                    title="Hapus"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
                <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Tambah Chat</h4>
                <div className="grid gap-2 md:grid-cols-2">
                    <input
                        value={formLabel}
                        onChange={(e) => setFormLabel(e.target.value)}
                        placeholder="Label (e.g. ops, security, mgmt)"
                        className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white text-sm"
                    />
                    <input
                        value={formChatId}
                        onChange={(e) => setFormChatId(e.target.value)}
                        placeholder="Telegram Chat ID"
                        className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white text-sm font-mono"
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={useFilter} onChange={(e) => setUseFilter(e.target.checked)} className="rounded" />
                    Batasi severity (kosongkan = semua)
                </label>
                {useFilter && (
                    <div className="flex flex-wrap gap-2">
                        {SEVERITY_OPTIONS.map((sev) => (
                            <label key={sev} className={`text-xs px-2 py-1 border rounded cursor-pointer ${formSeverities.includes(sev) ? "bg-blue-100 dark:bg-blue-900/30 border-blue-300 text-blue-700 dark:text-blue-300" : "border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
                                <input type="checkbox" className="hidden" checked={formSeverities.includes(sev)} onChange={() => toggleSeverity(sev)} />
                                {sev}
                            </label>
                        ))}
                    </div>
                )}
                <button
                    onClick={handleAdd}
                    disabled={isPending}
                    className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Tambah
                </button>
            </div>
        </div>
    );
}
