// Static reference data for the coverage matrix modals. Descriptions are the
// canonical short summaries from MITRE ATT&CK Enterprise tactics (free,
// attack.mitre.org) and ISO/IEC 27001:2022 Annex A control titles/descriptions
// (control titles are public; one-line intents summarized per the widely
// published ISMS interpretations — see docs/research/enterprise-siem-capabilities.md
// section 6 for the verbatim-text limitation on ISO quotes).

export type AttackTacticInfo = {
  id: string;
  name: string;
  description: string;
  url: string;
};

export const ATTACK_TACTIC_INFO: Record<string, AttackTacticInfo> = {
  Reconnaissance: { id: "TA0043", name: "Reconnaissance", description: "The adversary is trying to gather information they can use to plan future operations — harvesting host, software, identity, and network data, and searching for victim information.", url: "https://attack.mitre.org/tactics/TA0043/" },
  "Resource Development": { id: "TA0042", name: "Resource Development", description: "The adversary is trying to establish resources they can use to support operations — acquiring infrastructure, domains, and capabilities (malware, exploits, certificates).", url: "https://attack.mitre.org/tactics/TA0042/" },
  "Initial Access": { id: "TA0001", name: "Initial Access", description: "The adversary is trying to get into your network — exploiting public-facing applications, phishing, valid accounts, or external remote services.", url: "https://attack.mitre.org/tactics/TA0001/" },
  Execution: { id: "TA0002", name: "Execution", description: "The adversary is trying to run malicious code — command and scripting interpreters, container abuse, native API, or user execution.", url: "https://attack.mitre.org/tactics/TA0002/" },
  Persistence: { id: "TA0003", name: "Persistence", description: "The adversary is trying to maintain their foothold — creating accounts, autostart mechanisms, boot/system modifications, or scheduled tasks.", url: "https://attack.mitre.org/tactics/TA0003/" },
  "Privilege Escalation": { id: "TA0004", name: "Privilege Escalation", description: "The adversary is trying to gain higher-level permissions — exploitation for privilege escalation, abuse of elevation control mechanisms, or domain policy modification.", url: "https://attack.mitre.org/tactics/TA0004/" },
  "Defense Evasion": { id: "TA0005", name: "Defense Evasion", description: "The adversary is trying to avoid being detected — uninstalling security software, clearing logs, obfuscation, or masquerading files and processes.", url: "https://attack.mitre.org/tactics/TA0005/" },
  "Credential Access": { id: "TA0006", name: "Credential Access", description: "The adversary is trying to steal account names and passwords — brute forcing, credential dumping, keylogging, or intercepting authentication traffic.", url: "https://attack.mitre.org/tactics/TA0006/" },
  Discovery: { id: "TA0007", name: "Discovery", description: "The adversary is trying to figure out your environment — network service/system scans, network share discovery, permission groups, and remote system discovery.", url: "https://attack.mitre.org/tactics/TA0007/" },
  "Lateral Movement": { id: "TA0008", name: "Lateral Movement", description: "The adversary is trying to move through your environment — internal spearphishing, remote services (SSH/SMB/RDP), and lateral tool transfer.", url: "https://attack.mitre.org/tactics/TA0008/" },
  Collection: { id: "TA0009", name: "Collection", description: "The adversary is trying to gather data of interest — data from network shared drives, local systems, email, and input capture.", url: "https://attack.mitre.org/tactics/TA0009/" },
  "Command and Control": { id: "TA0011", name: "Command and Control", description: "The adversary is trying to communicate with compromised systems — application layer protocols, encrypted channels, proxy use, and web protocols.", url: "https://attack.mitre.org/tactics/TA0011/" },
  Exfiltration: { id: "TA0010", name: "Exfiltration", description: "The adversary is trying to steal data — exfiltration over C2 channel, alternative protocols, web services, or scheduled transfer.", url: "https://attack.mitre.org/tactics/TA0010/" },
  Impact: { id: "TA0040", name: "Impact", description: "The adversary is trying to manipulate, interrupt, or destroy your systems and data — service stop, data destruction, network DoS, and account access removal.", url: "https://attack.mitre.org/tactics/TA0040/" },
};

// Technique descriptions for the technique ids used by DataGuard default rules.
// Extend as more techniques get mapped. Unknown ids render the id only.
export const ATTACK_TECHNIQUE_INFO: Record<string, { name: string; url: string }> = {
  "T1071": { name: "Application Layer Protocol", url: "https://attack.mitre.org/techniques/T1071/" },
  "T1046": { name: "Network Service Discovery", url: "https://attack.mitre.org/techniques/T1046/" },
  "T1078": { name: "Valid Accounts", url: "https://attack.mitre.org/techniques/T1078/" },
  "T1078.003": { name: "Valid Accounts: Local Accounts", url: "https://attack.mitre.org/techniques/T1078/003/" },
  "T1110": { name: "Brute Force", url: "https://attack.mitre.org/techniques/T1110/" },
  "T1136": { name: "Create Account", url: "https://attack.mitre.org/techniques/T1136/" },
  "T1190": { name: "Exploit Public-Facing Application", url: "https://attack.mitre.org/techniques/T1190/" },
  "T1499": { name: "Endpoint Denial of Service", url: "https://attack.mitre.org/techniques/T1499/" },
  "T1529": { name: "System Shutdown/Reboot", url: "https://attack.mitre.org/techniques/T1529/" },
  "T1562.004": { name: "Impair Defenses: Disable or Modify System Firewall", url: "https://attack.mitre.org/techniques/T1562/004/" },
  "T1498": { name: "Network Denial of Service", url: "https://attack.mitre.org/techniques/T1498/" },
};

export type IsoControlInfo = {
  id: string;
  title: string;
  description: string;
};

// ISO/IEC 27001:2022 Annex A control titles (public) with a one-line intent.
export const ISO_CONTROL_INFO: Record<string, IsoControlInfo> = {
  "A.5.1": { id: "A.5.1", title: "Policies for information security", description: "Information security policies didefinisikan, disetujui, dipublikasikan, dan dikomunikasikan." },
  "A.7.11": { id: "A.7.11", title: "Supporting utilities", description: "Utility pendukung (listrik, pendinginan, dsb.) dilindungi dan dipantau agar informasi tidak terganggu — cakupan SIEM: alarm hardware (power/thermal) dari perangkat." },
  "A.8.2": { id: "A.8.2", title: "Privileged access rights", description: "Akses istimewa (privileged) dibatasi dan dikelola — cakupan SIEM: deteksi login akun admin di luar jam kerja." },
  "A.8.5": { id: "A.8.5", title: "Secure authentication", description: "Autentikasi dilindungi sesuai risiko — cakupan SIEM: brute force, kegagalan login berulang, sukses setelah gagal, login dari sumber tak dikenal." },
  "A.8.6": { id: "A.8.6", title: "Capacity management", description: "Kapasitas resource dipantau dan diproyeksikan — cakupan SIEM: disk penuh, service crash pada host." },
  "A.8.9": { id: "A.8.9", title: "Configuration management", description: "Konfigurasi perangkat keras/software (termasuk perubahan konfigurasi) didirikan, didokumentasikan, dan diaplikasikan — cakupan SIEM: config_changed & perubahan di luar jendela maintenance." },
  "A.8.15": { id: "A.8.15", title: "Logging", description: "Log aktivitas, pengecualian, fault, dan event relevan dihasilkan, disimpan, dilindungi, dan dianalisis — cakupan SIEM: seluruh pipeline syslog, retensi, dan deteksi sumber yang berhenti mengirim log." },
  "A.8.16": { id: "A.8.16", title: "Monitoring activities", description: "Jaringan, sistem, dan aplikasi dipantau untuk perilaku anomali dan tindakan tepat diambil — cakupan SIEM: rule engine seluruh kategori (auth/network/firewall/system), baseline anomaly, IOC match." },
  "A.8.20": { id: "A.8.20", title: "Network security", description: "Jaringan dan perangkat jaringan diamankan — cakupan SIEM: deny burst, port scan, IPS signature, anomali firewall." },
};
