"use client";

import { useTranslations } from "next-intl";
import SubNav from "@/components/ui/sub-nav";

export default function EpdrNav({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const t = useTranslations("Epdr.playbooksV2.nav");
  return <SubNav label={t("label")} items={[
    { href: "/admin/epdr", label: t("fleet"), exact: true },
    { href: "/admin/epdr/threats", label: t("threats") },
    ...(isAdmin ? [
      { href: "/admin/epdr/playbooks", label: t("playbooks") },
      { href: "/admin/epdr/approvals", label: t("approvals") },
      { href: "/admin/epdr/activity", label: t("activity") },
      { href: "/admin/epdr/settings", label: t("settings") },
    ] : []),
  ]} />;
}
