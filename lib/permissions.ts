export type GlobalRole = "superadmin" | "admin" | "staff";
export type SiteRole = "admin" | "staff" | null | undefined;

export function canManageGlobalUsers(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageGlobalSettings(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageGlobalReferenceData(role: GlobalRole): boolean {
  return role === "superadmin";
}

export function canManageActiveSite(role: GlobalRole, roleInSite: SiteRole): boolean {
  return role === "superadmin" || roleInSite === "admin";
}

export function canSubmitChecklist(activeSiteId: number | null | undefined): boolean {
  return typeof activeSiteId === "number";
}
