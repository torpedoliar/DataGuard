# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Site operations staff** (shift technicians, general IT staff) open the Security pages daily. Most are not security specialists; they need to know what is wrong, how urgent it is, and what to do next. *(confirmed)*
- **IT admins / security team** use the same pages for investigation and need full technical detail on demand. *(confirmed: mixed audience; plain summary first, technical detail via drill-down)*
- **Superadmin** configures connections to external systems (NCM, WatchGuard) per site, usually once, rarely revisited. *(inferred from role model)*

## Product Purpose

DataGuard (DC-Check) is a multi-site data center operations app: asset inventory, rack/cabling documentation, shift checklists, incidents, SIEM, and ISO/IEC 27001 evidence in one place. Success means a site team can see the state of its infrastructure and act on problems without switching tools.

## Positioning

One record per site that links physical assets, inspections, incidents, and security signals. External security data (WatchGuard EPDR/ThreatSync) lands in the same Incident workflow the team already uses, instead of a separate console.

## Operating Context

- Each site is isolated; users only see their assigned sites. The active site is chosen in the sidebar.
- Bilingual UI: English and Indonesian (next-intl, `messages/en.json`, `messages/id.json`).
- Dark operations-console UI is the default working environment.
- WatchGuard integration is currently **read-only**: dc-check reads endpoints, protection status, and threats; it never changes anything on WatchGuard. Write actions (scan, isolate, etc.) are designed but blocked in code.

## Capabilities and Constraints

- Roles: superadmin (global + credentials), site admin (site rules, approvals), site staff (read-only Security pages).
- WatchGuard: one connection per site; credentials are write-only in the UI (never shown back).
- Automatic repair of WatchGuard protection is not available through the public API; it is a manual handoff.
- Terminology to keep: Incident, Site, Endpoint, Threat, Kill switch.

## Evidence on Hand

- Real WatchGuard data exists only after a site connection is configured; until then the Security pages are empty. No sample data may be presented as real.

## Product Principles

1. Plain language first, technical detail one click away.
2. Every empty or broken state tells the user the next step.
3. Never imply an action happened on WatchGuard when it was only simulated or blocked.
4. Site isolation is visible: the user always knows which site they are looking at.
