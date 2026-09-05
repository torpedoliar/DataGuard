// The 14 MITRE ATT&CK Enterprise tactics, in kill-chain order. Lives in lib/
// (not in the "use server" actions file) because a "use server" module may only
// export async functions — exporting this const array breaks the Next.js build.
export const SIEM_ATTACK_TACTICS = [
  "Reconnaissance",
  "Resource Development",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command and Control",
  "Exfiltration",
  "Impact",
] as const;

export type SiemAttackTactic = (typeof SIEM_ATTACK_TACTICS)[number];
