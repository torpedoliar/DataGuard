"use client";

import { useEpdrTimeZone } from "./time-zone-provider";
import { formatEpdrDateTime } from "@/lib/epdr/time-zone";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getEpdrNotificationInbox, markEpdrNotificationRead } from "@/actions/epdr-notifications";

type Inbox = Exclude<Awaited<ReturnType<typeof getEpdrNotificationInbox>>, { message: string }>;

export default function NotificationInbox({ locale }: { locale: string }) {
  const t = useTranslations("Epdr.notifyV2");
  const { timeZone } = useEpdrTimeZone();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getEpdrNotificationInbox().then((data) => {
      if (!active) return;
      if ("message" in data) { setError(true); return; }
      setInbox(data);
      setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [revision]);

  if (error) return <div><p role="alert" className="text-sm text-ops-muted">{t("inboxUnavailable")}</p>
    <button type="button" className="text-sm text-ops-accent" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</button></div>;
  if (!inbox || inbox.notifications.length === 0) return null;

  return <section className="ops-panel p-5">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-semibold text-ops-text">{t("inboxTitle")}</h2>
      <span className="text-sm text-ops-muted">{t("unread", { count: inbox.unreadCount })}</span>
    </div>
    {inbox.unreadCount > 0 && <p className="mt-1 text-xs text-ops-subtle">{t("digest", {
      assigned: inbox.digest.assigned, overdue: inbox.digest.overdue, incidents: inbox.digest.incidents,
    })}</p>}
    <ul className="mt-3 divide-y divide-ops-border">
      {inbox.notifications.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        {item.kind === "digest" || item.incidentId === null
          ? <span className="text-ops-text">{t("kind.digest", {
              assigned: inbox.digest.assigned, overdue: inbox.digest.overdue, incidents: inbox.digest.incidents,
            })}</span>
          : <Link href={`/${locale}/admin/incidents/${item.incidentId}`} className="text-ops-accent">
              {t(`kind.${item.kind}`, { id: item.incidentId })}
            </Link>}
        <span className="text-xs text-ops-subtle">{formatEpdrDateTime(item.createdAt, timeZone, locale)}</span>
        {item.readAt
          ? <span className="text-xs text-ops-subtle">{t("read")}</span>
          : <button type="button" disabled={pending} onClick={() => startTransition(async () => {
              try {
                const result = await markEpdrNotificationRead({ notificationId: item.id });
                if ("message" in result) setError(true);
                else setRevision((value) => value + 1);
              } catch { setError(true); }
            })} className="text-xs text-ops-accent disabled:opacity-50">{t("markRead")}</button>}
      </li>)}
    </ul>
  </section>;
}
