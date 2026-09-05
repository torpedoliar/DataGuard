# Kapabilitas SIEM Enterprise — Riset & Gap Analysis vs DataGuard SIEM

> Tanggal: 2026-09-05 · Sumber: dokumentasi resmi vendor dan badan standar (primary sources), diverifikasi via WebFetch/WebSearch.
> Tujuan: dasar gap analysis untuk modul SIEM bawaan DataGuard (repo `dc-check`).

## 1. Ringkasan Eksekutif

- **Pengumpulan log**: SIEM enterprise menerima Syslog (UDP/TCP), CEF, dan API/agent. Microsoft Sentinel menerima Syslog/CEF via Azure Monitor Agent ke tabel `Syslog`/`CommonSecurityLog`; NIST SP 800-92 membedakan pengumpulan *agentless* (push/pull) vs *agent-based*. DataGuard sudah punya receiver UDP/TCP/TLS + parser RFC3164/RFC5424, tetapi tidak punya agen, CEF, API pull, atau batch (Windows Event/EVTX).
- **Normalisasi skema**: semua produk besar punya skema umum — Sentinel ASIM, Graylog GIM/Illuminate, Sumo Logic Cloud SIEM Schema. DataGuard punya normalizer per vendor (9 profil) dengan field ternormalisasi, tapi skemanya privat dan tidak dipublikasikan/di-dokumentasikan sebagai model data resmi.
- **Aturan deteksi**: tipe aturan enterprise meliputi match/single-event, threshold, sequence/chain, aggregation, first-seen, outlier/baseline, indicator match terhadap threat intel, dan machine learning. DataGuard sudah punya 5 tipe (single_event, threshold, sequence, absence, baseline_anomaly) — cakupan inti sudah ada; yang belum ada adalah first-seen/per-entity state, indicator match, dan ML.
- **MITRE ATT&CK**: Sentinel memetakan deteksi ke tactics/techniques ATT&CK; Wazuh menanamkan `<mitre><id>` di tiap rule; QRadar punya mapping & heat map ATT&CK. DataGuard **tidak punya** mapping MITRE sama sekali — gap terbesar bersifat metadata, bukan mesin.
- **Threat intelligence**: produk enterprise mengintegrasikan feed TI dan mencocokkan IOC ke event (Sumo Logic `hasThreatMatch`, Elastic indicator match rule, Wazuh CDB lists). DataGuard punya modul *threat intel manual* (CVSS + upload bukti) tetapi **tidak** mencocokkan feed/IOC ke log otomatis — ini modul pelaporan, bukan TI operasional.
- **UEBA**: Sentinel UEBA membangun profil perilaku entity (user/host/IP) dengan ML, peer-group analysis, dan risk score. DataGuard hanya punya baseline volume per *source* (avg/hour) — baseline perilaku per user/entity belum ada.
- **Alert & case management**: alert dengan severity filter, retry/backoff, dedupe sudah ada di DataGuard; tetapi tidak ada *case/incident workflow* (status investigasi, assignee, task, tiket eksternal Jira/ServiceNow seperti di Sentinel automation rules dan Elastic Cases).
- **SOAR/otomasi respons**: Sentinel (automation rules + playbooks Logic Apps), Splunk ES (SOAR), Wazuh (Active Response) punya aksi respons otomatis. DataGuard hanya mengirim notifikasi (Telegram/webhook/email) — tidak ada aksi respons (mis. blok IP).
- **Retensi & tiering**: Sentinel punya analytics tier (90 hari gratis) + data lake tier murah untuk retensi jangka panjang; Graylog menonjolkan "data lake stores years of logs affordably". DataGuard sudah punya retensi berlapis (raw 90d / events 180d / findings 365d) + partisi mingguan + snapshot + arsip bukti — ini kekuatan relatif.
- **Standar**: NIST SP 800-92 (log management), ISO/IEC 27001:2022 A.8.15 (logging) & A.8.16 (monitoring), dan MITRE ATT&CK adalah rujukan yang harus dipenuhi; kepatuhan Wazuh/QRadar dipetakan eksplisit ke PCI DSS/GDPR/NIST 800-53. DataGuard belum punya *compliance reporting* terhadap kontrol-kontrol ini.

## 2. Matriks Capability SIEM Enterprise

Legend: ✓ = terdokumentasi di produk tsb (dengan sitasi di kolom sumber).

| # | Capability | Apa itu | Siapa yang punya | Sumber (primary) |
|---|-----------|---------|------------------|------------------|
| 1 | Log collection Syslog UDP/TCP | Menerima event syslog jaringan secara real-time | Sentinel (via AMA), Wazuh (syslog on server), NIST SP 800-92 §3.3 | [Sentinel data connectors](https://learn.microsoft.com/en-us/azure/sentinel/connect-data-sources), [Wazuh log data collection](https://documentation.wazuh.com/current/getting-started/index.html), [NIST SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final) |
| 2 | Agent-based & agentless collection | Agen di host vs pull/push tanpa agen | NIST SP 800-92 §3.4, Sentinel (AMA agent), Wazuh (universal agent + agentless monitoring) | [NIST SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final), [Sentinel data connectors](https://learn.microsoft.com/en-us/azure/sentinel/connect-data-sources), [Wazuh getting started](https://documentation.wazuh.com/current/getting-started/index.html) |
| 3 | CEF / format keamanan umum | Common Event Format untuk perangkat keamanan | Sentinel (`CommonSecurityLog`), Graylog Illuminate | [Sentinel data connectors](https://learn.microsoft.com/en-us/azure/sentinel/connect-data-sources), [Sentinel billing (CEF)](https://learn.microsoft.com/en-us/azure/sentinel/billing) |
| 4 | Normalization / common schema | Skema field ternormalisasi lintas vendor | Sentinel ASIM, Graylog GIM (Illuminate), Sumo Logic Schema v3 | [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview), [Graylog Illuminate](https://www.graylog.org/products/illuminate/), [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/) |
| 5 | Detection rules: match/single-event, threshold, sequence/chain, aggregation | Korelasi event jadi signal/finding | Sumo Logic (match/chain/threshold/aggregation rules), Elastic (custom query, threshold, EQL event correlation), DataGuard (single_event/threshold/sequence) | [Sumo rules](https://www.sumologic.com/help/docs/cse/rules/about-cse-rules/), [Elastic rule types](https://www.elastic.co/docs/solutions/security/detect-and-alert/about-detection-rules) |
| 6 | First-seen & outlier/baseline rules | Deteksi perilaku baru / menyimpang dari baseline entity | Sumo Logic (first seen, outlier rules), Elastic (new terms, ML), DataGuard (baseline_anomaly per source — terbatas) | [Sumo rules](https://www.sumologic.com/help/docs/cse/rules/about-cse-rules/), [Elastic rule types](https://www.elastic.co/docs/solutions/security/detect-and-alert/about-detection-rules) |
| 7 | Indicator match vs threat intel | Bandingkan event dengan indikator IOC | Elastic (indicator match rule), Sumo Logic (`hasThreatMatch`), Wazuh (CDB lists) | [Elastic rule types](https://www.elastic.co/docs/solutions/security/detect-and-alert/about-detection-rules), [Sumo rules](https://www.sumologic.com/help/docs/cse/rules/about-cse-rules/), [Wazuh CDB](https://documentation.wazuh.com/current/user-manual/ruleset/cdb-list.html) |
| 8 | MITRE ATT&CK mapping | Pemetaan rule/deteksi ke tactics & techniques | Sentinel (MITRE coverage page), Wazuh (`<mitre>` di rule), QRadar (mapping + heat map), Splunk ES (Detection Studio) | [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview), [Wazuh rules](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html), [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem), [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html) |
| 9 | UEBA / behavioral analytics | Profil perilaku entity + anomaly + risk score | Sentinel UEBA (ML profiles, peer group, Investigation Priority score), Splunk ES (UEBA Risk & Detection Tuning), Graylog (UEBA Anomaly Detection, Impossible Travel), QRadar UBA | [Sentinel UEBA](https://learn.microsoft.com/en-us/azure/sentinel/identify-threats-with-entity-behavior-analytics), [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html), [Graylog Security](https://www.graylog.org/products/security/), [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem) |
| 10 | Threat intelligence integration | Feed IOC eksternal diperkaya ke event/insight | Sentinel (threat intelligence + watchlists), Sumo Logic (threat intel sources + Insight Enrichment Server), Wazuh (CDB + feeds) | [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview), [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/), [Wazuh CDB](https://documentation.wazuh.com/current/user-manual/ruleset/cdb-list.html) |
| 11 | Alert triage & case/incident management | Status investigasi, owner, task, tiket eksternal | Sentinel (incidents + automation rules: triage/assign/close), Elastic Cases (Jira/ServiceNow/Resilient), Sumo Logic (unified case management, insights) | [Sentinel automation rules](https://learn.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules), [Elastic Cases](https://www.elastic.co/guide/en/security/current/cases.html), [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/) |
| 12 | SOAR / response automation | Aksi respons otomatis (playbook, active response) | Sentinel (playbooks Logic Apps), Splunk ES (SOAR), Wazuh (Active Response), Elastic Workflows | [Sentinel automation rules](https://learn.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules), [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html), [Wazuh getting started](https://documentation.wazuh.com/current/getting-started/index.html) |
| 13 | Dashboards & reporting | Visualisasi interaktif + report | Sentinel (workbooks), Elastic (Kibana dashboards), Graylog (Dashboards & Compliance Reports, AI report summaries), QRadar | [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview), [Graylog Security](https://www.graylog.org/products/security/) |
| 14 | Retensi berlapis & storage tiering | Hot/analytics tier + arsip murah jangka panjang | Sentinel (analytics tier 90 hari + data lake tier), Graylog (data lake, archive restore) | [Sentinel billing](https://learn.microsoft.com/en-us/azure/sentinel/billing), [Graylog Security](https://www.graylog.org/products/security/) |
| 15 | HA / scaling | Klaster server/indexer, load balancing | Wazuh (server cluster, indexer cluster, ILM), QRadar (Ariel + DR sync) | [Wazuh getting started](https://documentation.wazuh.com/current/getting-started/index.html), [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem) |
| 16 | RBAC & audit SIEM itu sendiri | Role-based access + audit log internal | Wazuh (API RBAC, SSO/LDAP), Sentinel (RBAC Azure, health/audit monitoring `SentinelHealth`) | [Wazuh getting started](https://documentation.wazuh.com/current/getting-started/index.html), [Sentinel billing (free data sources)](https://learn.microsoft.com/en-us/azure/sentinel/billing) |
| 17 | Compliance reporting | Pemetaan kontrol ke PCI DSS/GDPR/NIST dsb. | Wazuh (group rule PCI DSS/GDPR/HIPAA/NIST 800-53), Graylog (compliance content packs), NIST SP 800-92 sebagai rujukan | [Wazuh rules](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html), [Graylog Security](https://www.graylog.org/products/security/), [NIST SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final) |
| 18 | AI-assisted analysis | Ringkasan/penjelasan temuan oleh AI | Splunk ES (AI Assistant), Graylog (Dashboard AI assistant, AI report summaries), QRadar Advisor with Watson | [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html), [Graylog Security](https://www.graylog.org/products/security/), [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem) |

## 3. Rincian per Pillar

### 3.1 Log collection

- Microsoft Sentinel mengumpulkan data via konektor out-of-the-box (layanan Microsoft, ekosistem non-Microsoft) dan menerima **Syslog, Common Event Format (CEF), atau REST-API**; perangkat Linux mengirim syslog via **Azure Monitor Agent (AMA)** yang menulis ke tabel `Syslog` (`CommonSecurityLog` untuk CEF). Sumber: [Sentinel data connectors](https://learn.microsoft.com/en-us/azure/sentinel/connect-data-sources).
- NIST SP 800-92 §3.4 mendefinisikan dua mode pengumpulan SIEM: **agentless** ("the SIEM server receives data from the individual log generating hosts without needing to have any special software installed on those hosts") dan **agent-based** (agen melakukan filtering/agregasi/normalisasi lalu transmisi near-real-time). Sumber: [NIST SP 800-92](https://csrc.nist.gov/pubs/sp/800/92/final), PDF full text: https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-92.pdf (diverifikasi dari teks §3.4).
- Wazuh mendokumentasikan **log data collection** termasuk "Configuring syslog on the Wazuh server", plus **agentless monitoring** untuk perangkat tanpa agen, dan konektor cloud (AWS/Azure/GCP/GitHub/Office 365). Sumber: [Wazuh documentation](https://documentation.wazuh.com/current/getting-started/index.html).
- Graylog/Sumo Logic menonjolkan ingestion via sensors/konektor lintas sumber on-premise dan cloud. Sumber: [Graylog Security](https://www.graylog.org/products/security/), [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/).

### 3.2 Normalisasi & skema umum

- Sentinel: "Data normalization ... uses both query time and ingestion time normalization to translate various sources into a uniform, normalized view" — model **ASIM (Advanced Security Information Model)**. Sumber: [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview).
- Graylog Illuminate: "Log parsing and normalization across diverse data sources" dengan **Graylog Information Model (GIM)** sebagai skema umum. Sumber: [Graylog Illuminate](https://www.graylog.org/products/illuminate/).
- Sumo Logic Cloud SIEM mendokumentasikan **Cloud SIEM Schema v3** dan record processing pipeline. Sumber: [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/).

### 3.3 Detection rules & korelasi

- Sumo Logic Cloud SIEM rule types (nama persis dari docs): **match rule** ("stateless: it looks at a single record"), **chain rule** ("two or more types of events ... frequency of each over a time window"), **aggregation rule**, **threshold rule**, **first seen rule** ("behavior by an entity ... has not been seen before"), **outlier rule** ("deviates from its baseline activity"; Cloud SIEM "automatically creates a baseline model of normal behavior"). Sumber: [Sumo rules](https://www.sumologic.com/help/docs/cse/rules/about-cse-rules/).
- Elastic Security rule types: **custom query** (KQL/Lucene), **threshold**, **event correlation (EQL)** ("correlate events by shared fields across time"), **new terms**, **indicator match** ("Compares source event fields against threat intelligence indices"), **machine learning**, **ES|QL**. Sumber: [Elastic rule types](https://www.elastic.co/docs/solutions/security/detect-and-alert/about-detection-rules).
- Wazuh rule engine: level 0–16, kondisi `match`/`regex` (osmatch/osregex/pcre2), `field`, temporal (`time`, `weekday`), `frequency` + `timeframe` (threshold dalam window), `ignore` (cooldown), `same_*`/`different_*` (korelasi field antar event). Sumber: [Wazuh rules syntax](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html).
- MITRE ATT&CK: "a globally-accessible knowledge base of adversary tactics and techniques based on real-world observations" — dipakai untuk detection engineering & coverage mapping. Sumber: [attack.mitre.org](https://attack.mitre.org/). Sentinel memvisualisasikan "security status ... based on the tactics and techniques from the MITRE ATT&CK® framework" ([Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview)); Wazuh menanamkan `<mitre><id>T1499</id></mitre>` pada rule ([Wazuh rules](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html)); QRadar punya "MITRE ATT&CK mapping and visualization" dan "MITRE heat map calculations" ([QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem)).

### 3.4 UEBA & baseline anomaly

- Sentinel UEBA "uses machine learning to build dynamic behavioral profiles for users, hosts, IP addresses, applications, and other entities", dengan **peer group analysis**, **blast radius evaluation**, dan dua skor (Investigation Priority 0–10, Anomaly Score 0–1). Sumber: [Sentinel UEBA](https://learn.microsoft.com/en-us/azure/sentinel/identify-threats-with-entity-behavior-analytics).
- Splunk ES: "UEBA Risk and Detection Tuning" menggunakan behavioral analytics & ML untuk insider threats. Sumber: [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html).
- Graylog Security: "Impossible Travel Detection", "Log Volume Anomaly Detection", "Risk Score aggregation by asset", fitur "UEBA Anomaly Detection". Sumber: [Graylog Security](https://www.graylog.org/products/security/).
- QRadar: UBA rules dengan "User risk score information" dan Machine Learning Analytics app ("Individual (Numeric) user models", "Peer group models"). Sumber: [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem).

### 3.5 Threat intelligence & enrichment

- Sentinel: "Integrate numerous sources of threat intelligence ... to detect malicious activity in your environment and provide context to security investigators" plus **watchlists** (high-value assets, terminated employees, dsb.). Sumber: [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview).
- Sumo Logic Cloud SIEM: threat intel via fungsi `hasThreatMatch` dalam rule expressions dan "Insight Enrichment Server". Sumber: [Sumo rules](https://www.sumologic.com/help/docs/cse/rules/about-cse-rules/), [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/).
- Wazuh: **CDB lists** — "to create a white/black list of users, file hashes, IP addresses, or domain names", dengan lookup `address_match_key` untuk IP. Sumber: [Wazuh CDB lists](https://documentation.wazuh.com/current/user-manual/ruleset/cdb-list.html).
- Enrichment aset: QRadar "Asset Profiles & Importance" dan "asset identification". Sumber: [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem).

### 3.6 Alert triage & case management

- Sentinel **incidents** adalah container investigasi ("a 'case file' ... container for alerts, entities, comments"); automation rules dapat "Triage new incidents by changing their status from New to Active and assigning an owner", men-tag, men-suppress, dan menutup dengan closing reason. Sumber: [Sentinel automation rules](https://learn.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules), [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview).
- Elastic **Cases**: "Create cases to collect and share information about security incidents and investigations" — lampirkan alert/timeline/entity, case metrics, dan "integrate with external ticketing systems like Jira, ServiceNow, and IBM Resilient". Sumber: [Elastic Cases](https://www.elastic.co/guide/en/security/current/cases.html).
- Sumo Logic: "Unified case management: The workflow interface where security incidents are tracked, documented, and managed from start to finish"; **Insights** mengelompokkan signals terkait. Sumber: [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/).

### 3.7 SOAR / response automation

- Sentinel playbooks = "workflows built in Azure Logic Apps" untuk "Automate and orchestrate your threat response"; automation rules memicunya otomatis per incident/alert. Sumber: [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview), [automation rules](https://learn.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules).
- Splunk ES menyertakan **SOAR** untuk "automated TDIR workflows". Sumber: [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html).
- Wazuh **Active Response** (contoh: "Blocking SSH brute-force attack with Active Response", "Disabling a Linux user account"). Sumber: [Wazuh docs](https://documentation.wazuh.com/current/getting-started/index.html).
- Elastic Workflows menangani "alert triage, enrichment, and response". Sumber: [Elastic Security](https://www.elastic.co/security).

### 3.8 Dashboards, reporting & compliance

- Sentinel **workbooks**: "interactive visual reports ... built-in workbook templates". Sumber: [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview).
- Graylog Security: "Dashboards & Compliance Reports", "Prebuilt compliance content packs activate audit-ready parsing, dashboards, and alerts from day one", "AI-generated report summaries". Sumber: [Graylog Security](https://www.graylog.org/products/security/).
- Wazuh memetakan rule ke kepatuhan lewat group: contoh rule di docs memuat `pci_dss_10.6.1`, `gdpr_IV_35.7.d`, `gpg13_4.3` — platform menonjolkan compliance PCI DSS, GDPR, HIPAA, NIST 800-53, TSC. Sumber: [Wazuh rules](https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html), [Wazuh docs](https://documentation.wazuh.com/current/getting-started/index.html).
- ISO/IEC 27001:2022 — kontrol Annex A terkait: **A.8.15 Logging** ("Logging activities, exceptions, faults and other relevant events shall be produced, stored, protected and analysed") dan **A.8.16 Monitoring activities** ("Networks, systems and applications shall be monitored for anomalous behaviour and appropriate actions taken"). Catatan: teks verbatim ISO berbayar; kutipan di atas adalah teks kontrol yang lazim dikutip dan diverifikasi silang via [ISMS.online — A.8.15](https://www.isms.online/iso-27001/annex-a-controls/a-8-15-logging/) (situs menjelaskan kedua kontrol, bukan salinan standar resmi). Halaman resmi [iso.org/standard/27001](https://www.iso.org/standard/27001) memblokir akses otomatis (HTTP 403) — lihat bagian 6.

### 3.9 Retensi, storage tiering & HA

- Sentinel: "Retain all data ingested into the workspace at no charge for the first 90 days. Retention beyond 90 days is charged"; **data lake tier** = "low-cost retention state for the preservation of data for such things as regulatory compliance" dengan kompresi 6:1; opsi **Lake tier** untuk "high-volume, low-value logs at a low price". Sumber: [Sentinel billing](https://learn.microsoft.com/en-us/azure/sentinel/billing).
- Graylog Security: "Built-in data lake stores years of logs affordably without counting against your license" + "Parallel archive restore retrieves precise compliance records in hours, not weeks". Sumber: [Graylog Security](https://www.graylog.org/products/security/).
- QRadar: Ariel storage + "Configuring the retention policy" + Data Synchronization app untuk disaster recovery. Sumber: [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem).
- NIST SP 800-92 membedakan **log retention** ("archiving logs on a regular basis as part of standard operational activities") vs **log preservation** ("keeping logs that normally would be d[eleted]" untuk kebutuhan legal/regulasi). Sumber: teks §4.2 pada [NIST SP 800-92 PDF](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-92.pdf).
- HA/scaling: Wazuh mendokumentasikan "Types of nodes in a Wazuh server cluster", load balancers, indexer cluster + index lifecycle management. Sumber: [Wazuh docs](https://documentation.wazuh.com/current/getting-started/index.html).

### 3.10 RBAC & audit SIEM itu sendiri

- Wazuh: "Role-Based Access Control" pada server API, Single Sign-On (Okta/Microsoft Entra ID/Keycloak), AD/LDAP. Sumber: [Wazuh docs](https://documentation.wazuh.com/current/getting-started/index.html).
- Sentinel: mendokumentasikan "Auditing and health monitoring for Microsoft Sentinel" (tabel `SentinelHealth` sebagai sumber data gratis) dan menurunkan RBAC dari Azure RBAC. Sumber: [Sentinel billing](https://learn.microsoft.com/en-us/azure/sentinel/billing), [Sentinel overview](https://learn.microsoft.com/en-us/azure/sentinel/overview).

### 3.11 AI-assisted analysis

- Splunk ES "AI Assistant ... for guidance, queries, summaries, and reports". Sumber: [Splunk ES](https://www.splunk.com/en_us/products/enterprise-security.html).
- Graylog: "Dashboard AI assistant helps explain what's going on", "AI-generated report summaries". Sumber: [Graylog Security](https://www.graylog.org/products/security/).
- QRadar Advisor with Watson: relationship graphs, observable/indicator analysis, STIX export. Sumber: [QRadar docs](https://www.ibm.com/docs/en/qradar-common?topic=overview-ibm-qradar-siem).

## 4. Gap Analysis vs DataGuard SIEM

Legend: ✓ = sudah ada · ◐ = sebagian/terbatas · ✗ = tidak ada.
Referensi kode: `lib/siem/*`, `db/schema.ts`, `scripts/syslog-receiver.ts`, `scripts/siem-*-worker.ts`, `actions/siem-*.ts`, `actions/threat-intel.ts`.

| Pillar | Status | Bukti di repo | Catatan gap |
|--------|--------|---------------|-------------|
| Transport syslog UDP/TCP/TLS | ✓ | `lib/siem/receiver.ts` (dgram/net/tls), enum `syslog_transport` | Paritas dengan produk enterprise untuk syslog |
| Parser RFC3164/RFC5424 + fallback | ✓ | `lib/siem/syslog-parser.ts` (`rfc3164`/`rfc5424`/`fallback`, `awplusPattern`) | — |
| Normalizer per vendor | ✓ | `lib/siem/normalizers/` (mikrotik, cisco, fortigate, linux, watchguard, paloalto, juniper, checkpoint, generic) | 9 profil; belum ada CEF, Windows Event, dan format keamanan umum lain |
| Agent-based collection (endpoint telemetry) | ✗ | — | Tidak ada agen; syslog-only. Sesuai positioning (perangkat jaringan DC) tapi membatasi deteksi host |
| API/agentless pull (cloud, Office 365, dsb.) | ✗ | — | Tidak ada konektor pull API |
| Skema normalisasi terdokumentasi | ◐ | `lib/siem/normalizers/types.ts` (category, normalizedType, action, outcome, srcIp/dstIp, username, tags) | Skema ada & konsisten tapi tidak dipublikasikan/dinamai sebagai model data (vs ASIM/GIM) |
| Rule single_event / threshold / sequence | ✓ | enum `siem_rule_type`, `lib/siem/rule-engine.ts` | 5 tipe aturan; default-rules mengcover auth, network, firewall, system, SIEM health |
| Rule absence (source silent) | ✓ | `evaluateAbsence()` | Sesuatu yang jarang dimiliki produk lain — kekuatan |
| Rule baseline_anomaly | ◐ | `evaluateBaseline()` — baseline avg/hour **per source**, threshold multiplier | Baseline hanya volume-log per sumber, bukan perilaku per user/entity; bukan ML |
| First-seen / new terms per entity | ◐ | `auth.new_username_seen` via tag `new_username` (diproduksi normalizer) | Tidak ada rule-type first-seen generik |
| Indicator match vs threat intel feed | ✗ | — | Threat intel DataGuard manual, tidak mengkorelasikan IOC ke log (`grep` tanpa hasil untuk geoip/watchlist/sigma) |
| MITRE ATT&CK mapping | ✗ | `grep mitre/ATTACK` di `lib/siem` & schema: tidak ada | Gap metadata: kolom tactic/technique + coverage view |
| UEBA (profil entity, peer group, risk score) | ✗ | — | Hanya baseline volume per source |
| Alert channel Telegram/webhook/email + severity filter | ✓ | `lib/siem/alerts.ts` (3 kanal, severityFilter per recipient, dedupe, retry eksponensial, MAX_SEND_RETRIES) | — |
| Alert queue & backoff | ✓ | `sendPendingSiemAlerts()` (backoff base 15s × 2^retry) | — |
| Case/incident management (status investigasi, owner, task, tiket Jira/ServiceNow) | ◐ | `siemFindings.status` = Open/Acknowledged/Resolved; acknowledgedBy/resolvedBy di schema | Tidak ada assignee granular, task checklist, komentar, eskalasi, integrasi tiket |
| SOAR / aksi respons otomatis | ✗ | — | Alert hanya notifikasi; tidak ada playbook/active response |
| AI analysis temuan | ✓ | `lib/siem/ai-analysis.ts`, `siem-ai-worker.ts`, `siem_ai_jobs`, enkripsi API key (AES-256-GCM) | Ringkasan + likelyCause + impact + recommendedActions; input di-redaksi (`redaction.ts`) |
| Redaksi data sensitif | ✓ | `lib/siem/redaction.ts` dipakai di alert & AI | Menonjol dibanding banyak produk |
| Quarantine event rusak | ✓ | `siem_events_quarantine`, `process-raw-event.ts` | — |
| Retensi berlapis + partisi + snapshot | ✓ | `lib/siem/retention.ts` (raw 90d/events 180d/findings+alerts 365d), `partitioning.ts` (partisi mingguan), `snapshots.ts`, arsip bukti (`evidence.ts`) | Setara konsep tiering; tanpa arsip objek-store murah (tier dingin) |
| Dashboards | ◐ | `actions/siem-dashboard.ts` (stats) + halaman findings/events | Tidak ada dashboard builder/workbook interaktif |
| Compliance reporting (ISO 27001/PCI DSS) | ◐ | Modul compliance repo + `threat-intelligence.ts` (ISO27001) | Belum ada pemetaan rule→kontrol A.8.15/A.8.16 atau report kepatuhan otomatis dari SIEM |
| HA / scaling | ◐ | Worker terpisah (parser/rule/alert/retention/snapshot/AI), batch & queue limit | Single-node DB; tidak ada klaster/DR seperti Wazuh cluster atau QRadar DR sync |
| RBAC SIEM | ◐ | `requireComplianceAdmin()` di actions (admin/superadmin) | Role granularity terbatas; tidak ada role read-only/analyst khusus SIEM |
| Audit penggunaan SIEM itu sendiri | ✓ | `logAuditManual` di `actions/threat-intel.ts`; audit infrastruktur repo | Audit aksi threat intel ada; pastikan seluruh aksi SIEM ter-audit |
| Asset enrichment (site/device/rack/zone) | ✓ | `lib/siem/source-enrichment.ts` (matchBy IP/hostname → site/device + assetCode, category, rack, zone) | Enrichment aset internal kuat; GeoIP eksternal tidak ada |

## 5. Rekomendasi Prioritas

### P0 (nilai tertinggi, biaya rendah — kerjakan dulu)

1. **MITRE ATT&CK mapping** — tambah kolom `mitre_tactics`/`mitre_techniques` pada `siem_rules` (array/JSON), isi untuk default rules (mis. `auth.failed_login_spike` → T1110 Brute Force), dan tampilkan coverage matrix sederhana. Preseden: Wazuh menanam `<mitre>` per rule; Sentinel & QRadar punya coverage/heat map. Inilah gap metadata yang paling terlihat oleh auditor ISO 27001 A.8.16.
2. **Pemetaan rule → kontrol ISO 27001** — tambah field `isoControls` pada rule (mis. `A.8.15`, `A.8.16`) dan generate report kepatuhan dari findings; Wazuh membuktikan pola ini murah (group string di rule, `pci_dss_10.6.1`).
3. **Indicator match IOC → log** — manfaatkan modul threat intel yang sudah ada: tambah tabel IOC (IP/domain/hash) + satu rule-type `indicator_match` yang menandai event saat srcIp/dstIp kena IOC; Wazuh CDB lists dan Elastic indicator match adalah model referensinya.

### P1 (penguatan menengah)

4. **First-seen rule generik** — rule-type `first_seen` per `groupBy` key (srcIp/username/dstIp) dengan state "pernah terlihat" per site; Sumo Logic first seen & Elastic new terms sebagai referensi.
5. **Case workflow pada findings** — tambah komentar, assignee, dan task checklist pada `siemFindings` (sekarang hanya Open/Acknowledged/Resolved), plus export/kirim ke webhook tiket; model: Sentinel incidents & Elastic Cases.
6. **Compliance content pack syslog DC** — paket rule + dashboard + report untuk kontrol logging ISO 27001 (siapa login, config change, perubahan di luar jam); Graylog "Prebuilt compliance content packs" sebagai referensi.
7. **Dashboard operator SIEM** — trend event/finding, top source, coverage MITRE; setara workbook Sentinel.

### P2 (skala & diferensiasi jangka panjang)

8. **Baseline per-entity (mini-UEBA)** — baseline per username/device selain per source; outlier rule dengan model statistik sederhana sebelum ML.
9. **SOAR ringan** — action webhook outbound pada finding kritis (mis. panggil API firewall untuk blok IP) dengan approval manual dulu; model: Wazuh Active Response.
10. **Arsip dingin objek-store** — dump partisi kedaluwarsa ke object storage sebelum drop agar retensi tahunan murah; model: Sentinel data lake tier & Graylog data lake.
11. **Konektor API pull** (cloud/Office 365) bila lingkup produk meluas ke host/cloud.

## 6. Catatan verifikasi (klaim yang tidak bisa diverifikasi dari primary source)

- **ISO/IEC 27001:2022 A.8.15/A.8.16 verbatim**: iso.org memblokir fetch otomatis (HTTP 403). Teks kontrol di dokumen ini adalah kutipan yang lazim dikutip dan dikonfirmasi silang via [ISMS.online](https://www.isms.online/iso-27001/annex-a-controls/a-8-15-logging/), yang eksplisit menyatakan tidak mereproduksi teks verbatim standar. Untuk sitasi formal, rujuk salinan resmi standar.
- **Splunk Enterprise Security (docs.splunk.com/help.splunk.com)**: seluruh halaman docs mengembalikan HTTP 403/404 terhadap fetch otomatis. Klaim Splunk ES (RBA, SOAR, UEBA tuning, AI Assistant, MITRE di Detection Studio) bersumber dari halaman produk resmi [splunk.com/en_us/products/enterprise-security.html](https://www.splunk.com/en_us/products/enterprise-security.html) — halaman resmi vendor, tetapi marketing, bukan halaman dokumentasi teknis. Detail teknis seperti "correlation searches" dan "asset & identity framework" tidak terverifikasi.
- **Elastic Security** (halaman solusi): sebagian besar klaim diambil dari docs resmi (rule types, cases), namun halaman produk tidak menjelaskan Elastic Agent sebagai kolektor, ML untuk security, atau MITRE coverage secara detail — klaim tersebut tidak dikutip di dokumen ini.
- **Graylog Security docs (go2docs.graylog.org)**: diblokir login-screen; klaim Graylog bersumber dari halaman produk resmi [graylog.org/products/security](https://www.graylog.org/products/security/) dan [illuminate](https://www.graylog.org/products/illuminate/) (marketing resmi).
- **Wazuh halaman "features"** mengembalikan 404; klaim Wazuh diambil dari halaman getting-started, rules syntax, dan CDB lists resmi yang berhasil diverifikasi.
- **Sumo Logic Insight/Entity detail pages**: beberapa URL sub-dokumentasi 404; klaim Insight/Entity diambil dari struktur dokumentasi Cloud SIEM yang terverifikasi ("Insight generation, working with Entities" pada [Cloud SIEM docs](https://www.sumologic.com/help/docs/cse/)).
- **NIST SP 800-92**: halaman landing CSRC diverifikasi; detail isi (§3.4 agentless/agent-based, §4.2 retention vs preservation) diekstrak langsung dari PDF resmi https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-92.pdf.
- **Microsoft Sentinel data lake tier / UEBA pricing**: dokumen "data lake overview" dan "UEBA" dengan URL lain 404; klaim tiering & retensi diambil dari halaman billing resmi yang berhasil difetch penuh.
