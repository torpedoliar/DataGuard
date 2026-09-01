import { sql, relations } from "drizzle-orm";
import { integer, pgTable, text, serial, boolean, timestamp, pgEnum, uniqueIndex, jsonb, index, real } from "drizzle-orm/pg-core";
import { AnyPgColumn } from "drizzle-orm/pg-core";

// ==================== ENUMS ====================
export const roleEnum = pgEnum("role", ["superadmin", "admin", "staff"]);
export const roleInSiteEnum = pgEnum("role_in_site", ["admin", "staff"]);
export const shiftEnum = pgEnum("shift", ["Pagi", "Siang", "Malam"]);
export const statusEnum = pgEnum("status", ["OK", "NOT OK"]);
export const portModeEnum = pgEnum("port_mode", ["Access", "Trunk", "Routed", "LACP"]);
export const portStatusEnum = pgEnum("port_status", ["Active", "Inactive", "Down"]);
export const speedEnum = pgEnum("speed", ["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"]);
export const mediaTypeEnum = pgEnum("media_type", ["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"]);
export const faceplateNumberingEnum = pgEnum("faceplate_numbering", ["zigzag", "sequential"]);
export const incidentSeverityEnum = pgEnum("incident_severity", ["Low", "Medium", "High", "Critical"]);
export const incidentStatusEnum = pgEnum("incident_status", ["Open", "In Progress", "Resolved", "Verified"]);
export const incidentUpdateTypeEnum = pgEnum("incident_update_type", ["created", "assigned", "status_changed", "comment", "evidence"]);
export const resolutionCategoryEnum = pgEnum("resolution_category", ["Hardware", "Power", "Network", "Environment", "Human Error", "False Alarm", "Other"]);
export const resolutionActionEnum = pgEnum("resolution_action", ["Replaced", "Reconfigured", "Restarted", "Cleaned", "Escalated", "No Action Needed"]);
export const syslogTransportEnum = pgEnum("syslog_transport", ["udp", "tcp", "tls"]);
export const syslogIngestStatusEnum = pgEnum("syslog_ingest_status", ["received", "parsed", "parse_failed", "dropped"]);
export const syslogVendorEnum = pgEnum("syslog_vendor", ["generic", "mikrotik", "cisco", "fortigate", "linux", "watchguard", "paloalto", "juniper", "checkpoint"]);
export const syslogTrustLevelEnum = pgEnum("syslog_trust_level", ["unknown", "trusted", "untrusted"]);
export const siemRuleTypeEnum = pgEnum("siem_rule_type", ["single_event", "threshold", "sequence", "absence", "baseline_anomaly"]);
export const siemFindingStatusEnum = pgEnum("siem_finding_status", ["Open", "Acknowledged", "Resolved"]);
export const siemAlertChannelEnum = pgEnum("siem_alert_channel", ["telegram", "webhook", "email"]);
export const siemAlertStatusEnum = pgEnum("siem_alert_status", ["pending", "sent", "failed"]);
export const siemAiJobStatusEnum = pgEnum("siem_ai_job_status", ["pending", "running", "completed", "failed"]);
export const emailAlertStatusEnum = pgEnum("email_alert_status", ["pending", "sent", "failed"]);

// ==================== SITES ====================
export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").unique().notNull(), // short code e.g. "DC-JKT", "DC-SBY"
  address: text("address"),
  description: text("description"),
  telegramChatId: text("telegram_chat_id"),
  latitude: text("latitude"),   // e.g. "-6.2088"
  longitude: text("longitude"), // e.g. "106.8456"
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== SITE TELEGRAM CHAT IDS (N23) ====================
// Multi-recipient per site, with optional severity filter. Falls back to
// sites.telegram_chat_id when this table is empty.
export const siteTelegramChatIds = pgTable("site_telegram_chat_ids", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }).notNull(),
  chatId: text("chat_id").notNull(),
  label: text("label").notNull(),
  // Comma-separated list of severities: "Low,Medium,High,Critical". Null = all severities.
  severityFilter: text("severity_filter"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  siteIdIdx: index("site_telegram_chat_ids_site_id_idx").on(table.siteId),
}));

export const siteWebhookUrls = pgTable("site_webhook_urls", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  label: text("label").notNull(),
  severityFilter: text("severity_filter"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  siteIdIdx: index("site_webhook_urls_site_id_idx").on(table.siteId),
}));

export const siteEmailAddresses = pgTable("site_email_addresses", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  label: text("label").notNull(),
  severityFilter: text("severity_filter"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  siteIdIdx: index("site_email_addresses_site_id_idx").on(table.siteId),
}));

// ==================== USERS ====================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  email: text("email").unique(),
  role: roleEnum("role").notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  photoPath: text("photo_path"),
  isActive: boolean("is_active").default(true),
  // Pre-selected site the user wants to land on after login (N50).
  // Validated against userSites on save; nullable for users with no preference
  // (login flow falls back to the existing /select-site experience, except for
  // users with exactly 1 accessible site, who auto-pick).
  defaultSiteId: integer("default_site_id").references(() => sites.id),
  lastLogin: timestamp("last_login"),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockoutUntil: timestamp("lockout_until"),
  createdAt: timestamp("created_at").defaultNow(),
  responsibleForGroups: jsonb("responsible_for_groups").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

// ==================== USER-SITE ASSIGNMENT ====================
export const userSites = pgTable("user_sites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  roleInSite: roleInSiteEnum("role_in_site").notNull().default("staff"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== CATEGORIES (GLOBAL) ====================
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").default("#3b82f6"),
});

// ==================== LOCATIONS (PER SITE) ====================
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  description: text("description"),
  // Room temperature (°C): current reading + alert threshold. Optional —
  // null = this room's temperature is not measured. The checklist records a
  // snapshot per audit; readings above threshold+3 auto-open an incident.
  tempC: real("temp_c"),
  tempThresholdC: real("temp_threshold_c"),
  // Exclude this room's temperature input from the audit form even when it
  // has a threshold (e.g. measured elsewhere, noise, already flagged).
  excludeTempCheck: boolean("exclude_temp_check").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== RACKS (PER SITE) ====================
// Unique per (site, lower(name)): app code (addRack/updateRack) catches
// 'UNIQUE constraint' errors, and getRackLayout merges racks by lowercased
// name, so case-variant duplicates must be rejected at the DB (finding #33).
export const racks = pgTable("racks", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  zone: text("zone"),
  totalU: integer("total_u").default(42),
  location: text("location"),
  locationId: integer("location_id").references(() => locations.id),
  isAuditable: boolean("is_auditable").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  siteNameUnique: uniqueIndex("racks_site_name_lower_unique").on(table.siteId, sql`lower(${table.name})`),
}));

// ==================== BRANDS (GLOBAL) ====================
export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  logoPath: text("logo_path"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== DEVICE GROUPS ====================
export const deviceGroups = pgTable("device_groups", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#3b82f6"),
  isActive: boolean("is_active").default(true).notNull(), // DB: 0029 creates NOT NULL DEFAULT true (finding #72)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==================== DEVICES (PER SITE) ====================
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  categoryId: integer("category_id").references(() => categories.id).notNull(),
  name: text("name").notNull(),
  assetCode: text("asset_code"),
  brandId: integer("brand_id").references(() => brands.id),
  location: text("location").notNull().default(""),
  locationId: integer("location_id").references(() => locations.id),
  rackName: text("rack_name"),
  rackPosition: integer("rack_position"),
  uHeight: integer("u_height").default(1),
  zone: text("zone"),
  ipAddress: text("ip_address"),
  description: text("description"),
  photoPath: text("photo_path"),
  isActive: boolean("is_active").default(true),
  // Exclude from the checklist audit population (form, grid, dashboard,
  // reports) while staying in the device inventory and the rack layout —
  // e.g. PDU / blade chassis that are not field-audited daily.
  excludeChecklist: boolean("exclude_checklist").notNull().default(false),
  responsibleGroups: jsonb("responsible_groups").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  // Faceplate layout for switch/router port diagrams. Null port count = no faceplate.
  faceplatePortCount: integer("faceplate_port_count"),
  faceplateUplinkCount: integer("faceplate_uplink_count").default(0),
  faceplateRows: integer("faceplate_rows").default(2),
  faceplateNumbering: faceplateNumberingEnum("faceplate_numbering").default("zigzag"),
});

// ==================== DEVICE PICS (Binding) ====================
export const devicePics = pgTable("device_pics", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").references(() => devices.id, { onDelete: "cascade" }).notNull(),
  groupId: integer("group_id").references(() => deviceGroups.id, { onDelete: "cascade" }).notNull(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueIndex: uniqueIndex("device_pics_device_group_unique").on(table.deviceId, table.groupId),
}));

// ==================== CHECKLIST ENTRIES (PER SITE) ====================
export const checklistEntries = pgTable("checklist_entries", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  userId: integer("user_id").references(() => users.id).notNull(),
  checkDate: text("check_date").notNull(),
  checkTime: text("check_time").notNull(),
  shift: shiftEnum("shift").notNull(),
  // Room-temperature snapshot for this audit: { [locationId]: {tempC,
  // thresholdC} } for every measured room touched by the audit. Reports
  // read this instead of the mutable locations.temp_c (which always holds
  // the latest reading).
  locationTemps: jsonb("location_temps").$type<Record<string, { tempC: number; thresholdC: number; locationName?: string }>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").references(() => checklistEntries.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  status: statusEnum("status").notNull(),
  remarks: text("remarks"),
  photoPath: text("photo_path"),
}, (table) => ({
  // Finding #08: one item per (entry, device). submitChecklist inserts items
  // inside one transaction with onConflictDoNothing so a retried/concurrent
  // submit of the same entry+device is a no-op instead of a duplicate item.
  entryDeviceUnique: uniqueIndex("checklist_items_entry_device_unique").on(table.entryId, table.deviceId),
}));

// ==================== INCIDENTS ====================
export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  checklistItemId: integer("checklist_item_id").references(() => checklistItems.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  severity: incidentSeverityEnum("severity").notNull().default("Medium"),
  status: incidentStatusEnum("status").notNull().default("Open"),
  createdById: integer("created_by_id").references(() => users.id),
  assignedToId: integer("assigned_to_id").references(() => users.id),
  dueDate: timestamp("due_date"),
  resolutionCategory: resolutionCategoryEnum("resolution_category"),
  resolutionAction: resolutionActionEnum("resolution_action"),
  resolvedById: integer("resolved_by_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  verifiedById: integer("verified_by_id").references(() => users.id),
  verifiedAt: timestamp("verified_at"),
  lastOverdueNotifiedAt: timestamp("last_overdue_notified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  checklistItemUnique: uniqueIndex("incidents_checklist_item_id_unique").on(table.checklistItemId),
}));

export const incidentUpdates = pgTable("incident_updates", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "cascade" }).notNull(),
  authorId: integer("author_id").references(() => users.id),
  updateType: incidentUpdateTypeEnum("update_type").notNull(),
  note: text("note"),
  photoPath: text("photo_path"),
  previousStatus: incidentStatusEnum("previous_status"),
  newStatus: incidentStatusEnum("new_status"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== VLANS (PER SITE) ====================
export const vlans = pgTable("vlans", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  vlanId: integer("vlan_id").notNull(),
  name: text("name").notNull(),
  subnet: text("subnet"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== NETWORK PORTS (PER SITE via device) ====================
export const networkPorts = pgTable("network_ports", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  portName: text("port_name").notNull(),
  // Optional override for the physical slot on the faceplate. Null = derive from portName.
  portIndex: integer("port_index"),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),
  portMode: portModeEnum("port_mode"),
  vlanId: integer("vlan_id").references(() => vlans.id),
  trunkVlans: text("trunk_vlans"),
  status: portStatusEnum("status"),
  speed: speedEnum("speed"),
  mediaType: mediaTypeEnum("media_type"),
  connectedToDeviceId: integer("connected_to_device_id").references(() => devices.id),
  connectedToPortId: integer("connected_to_port_id").references((): AnyPgColumn => networkPorts.id),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== RELATIONS ====================

export const sitesRelations = relations(sites, ({ many }) => ({
  userSites: many(userSites),
  devices: many(devices),
  racks: many(racks),
  locations: many(locations),
  vlans: many(vlans),
  checklistEntries: many(checklistEntries),
  incidents: many(incidents),
  syslogSources: many(syslogSources),
  syslogEvents: many(syslogEvents),
  siemFindings: many(siemFindings),
  telegramChats: many(siteTelegramChatIds),
  deviceGroups: many(deviceGroups),
  devicePics: many(devicePics),
  networkDocSettings: many(networkDocSettings),
  siemSettings: many(siemSettings, { relationName: "siemSettingsSite" }),
}));

export const siteTelegramChatIdsRelations = relations(siteTelegramChatIds, ({ one }) => ({
  site: one(sites, {
    fields: [siteTelegramChatIds.siteId],
    references: [sites.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  checklistEntries: many(checklistEntries),
  userSites: many(userSites),
  createdIncidents: many(incidents, { relationName: "createdIncidents" }),
  assignedIncidents: many(incidents, { relationName: "assignedIncidents" }),
  acknowledgedSiemFindings: many(siemFindings, { relationName: "acknowledgedSiemFindings" }),
  resolvedSiemFindings: many(siemFindings, { relationName: "resolvedSiemFindings" }),
}));

export const userSitesRelations = relations(userSites, ({ one }) => ({
  user: one(users, {
    fields: [userSites.userId],
    references: [users.id],
  }),
  site: one(sites, {
    fields: [userSites.siteId],
    references: [sites.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  devices: many(devices),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  devices: many(devices),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  site: one(sites, {
    fields: [locations.siteId],
    references: [sites.id],
  }),
  devices: many(devices),
  racks: many(racks),
}));

export const racksRelations = relations(racks, ({ one }) => ({
  site: one(sites, {
    fields: [racks.siteId],
    references: [sites.id],
  }),
  location: one(locations, {
    fields: [racks.locationId],
    references: [locations.id],
  }),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  site: one(sites, {
    fields: [devices.siteId],
    references: [sites.id],
  }),
  category: one(categories, {
    fields: [devices.categoryId],
    references: [categories.id],
  }),
  brand: one(brands, {
    fields: [devices.brandId],
    references: [brands.id],
  }),
  location: one(locations, {
    fields: [devices.locationId],
    references: [locations.id],
  }),
  checklistItems: many(checklistItems),
  networkPorts: many(networkPorts, { relationName: "devicePorts" }),
  incidents: many(incidents),
  syslogSources: many(syslogSources),
  syslogEvents: many(syslogEvents),
  siemFindings: many(siemFindings),
  devicePics: many(devicePics),
}));

// PIC group relation set (finding #31). Owners live in
// users.responsible_for_groups as a JSONB array of group ids — Drizzle cannot
// express a relation over a JSONB array, so group → owners is intentionally not
// modelled (the actions query it directly with a full users scan).
export const deviceGroupsRelations = relations(deviceGroups, ({ one, many }) => ({
  site: one(sites, {
    fields: [deviceGroups.siteId],
    references: [sites.id],
  }),
  devicePics: many(devicePics),
}));

export const devicePicsRelations = relations(devicePics, ({ one }) => ({
  device: one(devices, {
    fields: [devicePics.deviceId],
    references: [devices.id],
  }),
  group: one(deviceGroups, {
    fields: [devicePics.groupId],
    references: [deviceGroups.id],
  }),
  site: one(sites, {
    fields: [devicePics.siteId],
    references: [sites.id],
  }),
}));

export const checklistEntriesRelations = relations(checklistEntries, ({ one, many }) => ({
  site: one(sites, {
    fields: [checklistEntries.siteId],
    references: [sites.id],
  }),
  user: one(users, {
    fields: [checklistEntries.userId],
    references: [users.id],
  }),
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  entry: one(checklistEntries, {
    fields: [checklistItems.entryId],
    references: [checklistEntries.id],
  }),
  device: one(devices, {
    fields: [checklistItems.deviceId],
    references: [devices.id],
  }),
  incident: one(incidents, {
    fields: [checklistItems.id],
    references: [incidents.checklistItemId],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  site: one(sites, {
    fields: [incidents.siteId],
    references: [sites.id],
  }),
  device: one(devices, {
    fields: [incidents.deviceId],
    references: [devices.id],
  }),
  checklistItem: one(checklistItems, {
    fields: [incidents.checklistItemId],
    references: [checklistItems.id],
  }),
  createdBy: one(users, {
    fields: [incidents.createdById],
    references: [users.id],
    relationName: "createdIncidents",
  }),
  assignedTo: one(users, {
    fields: [incidents.assignedToId],
    references: [users.id],
    relationName: "assignedIncidents",
  }),
  resolvedBy: one(users, {
    fields: [incidents.resolvedById],
    references: [users.id],
  }),
  verifiedBy: one(users, {
    fields: [incidents.verifiedById],
    references: [users.id],
  }),
  updates: many(incidentUpdates),
}));

export const incidentUpdatesRelations = relations(incidentUpdates, ({ one }) => ({
  incident: one(incidents, {
    fields: [incidentUpdates.incidentId],
    references: [incidents.id],
  }),
  author: one(users, {
    fields: [incidentUpdates.authorId],
    references: [users.id],
  }),
}));

export const vlansRelations = relations(vlans, ({ one, many }) => ({
  site: one(sites, {
    fields: [vlans.siteId],
    references: [sites.id],
  }),
  networkPorts: many(networkPorts),
}));

export const networkPortsRelations = relations(networkPorts, ({ one }) => ({
  device: one(devices, {
    fields: [networkPorts.deviceId],
    references: [devices.id],
    relationName: "devicePorts"
  }),
  connectedToDevice: one(devices, {
    fields: [networkPorts.connectedToDeviceId],
    references: [devices.id],
    relationName: "connectedDevice"
  }),
  connectedToPort: one(networkPorts, {
    fields: [networkPorts.connectedToPortId],
    references: [networkPorts.id],
    relationName: "connectedPort"
  }),
  vlan: one(vlans, {
    fields: [networkPorts.vlanId],
    references: [vlans.id],
  }),
}));

// ==================== NETWORK DOC SETTINGS (PER SITE) ====================
// Each site may point at its own network-doc API instance (multi-site sync);
// env NETWORK_DOC_URL/NETWORK_DOC_API_KEY are the global default when a site
// has no row. api_key is encrypted at rest (lib/crypto.ts, same as
// siem_settings.ai_api_key).
export const networkDocSettings = pgTable("network_doc_settings", {
  siteId: integer("site_id").primaryKey().references(() => sites.id, { onDelete: "cascade" }),
  url: text("url"),
  apiKey: text("api_key"),
  intervalMs: integer("interval_ms"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==================== GLOBAL SETTINGS ====================
export const globalSettings = pgTable("global_settings", {
  id: serial("id").primaryKey(),
  appName: text("app_name").notNull().default("DataGuard"),
  logoPath: text("logo_path"),
  faviconPath: text("favicon_path"),
  telegramBotToken: text("telegram_bot_token"),
  telegramAlertTemplate: text("telegram_alert_template"),
  // Editable PIC email alert template (lib/email.ts), same {field} syntax as
  // the Telegram template; null → DEFAULT_EMAIL_ALERT_TEMPLATE.
  emailAlertTemplate: text("email_alert_template"),
  // SMTP relay config from Settings (UI). smtp_pass stored encrypted at rest
  // (lib/crypto.ts, same as siem_settings.ai_api_key); lib/email.ts resolves
  // env SMTP_URL first, then these structured fields (Outlook-style form),
  // then the legacy smtp_url column.
  smtpUrl: text("smtp_url"),
  smtpFrom: text("smtp_from"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  // "none" | "ssl" (implicit TLS, 465) | "starttls" (587) — null = starttls.
  smtpSecure: text("smtp_secure"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  notificationBaseUrl: text("notification_base_url"),
  // Network Docs sync (lib/network-doc.ts). Configured from the settings
  // page; env NETWORK_DOC_* overrides these when set. api_key is encrypted
  // at rest (lib/crypto.ts AES-256-GCM, same as siem_settings.ai_api_key).
  networkDocUrl: text("network_doc_url"),
  networkDocApiKey: text("network_doc_api_key"),
  networkDocSiteId: integer("network_doc_site_id"),
  networkDocIntervalMs: integer("network_doc_interval_ms"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ==================== AUDIT LOGS ====================
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  username: text("username"),  // snapshot so deleting user doesn't lose log
  userRole: text("user_role"),
  action: text("action").notNull(),        // CREATE | UPDATE | DELETE | LOGIN | LOGOUT | etc.
  entity: text("entity"),                  // devices | brands | racks | etc.
  entityId: integer("entity_id"),
  entityName: text("entity_name"),         // human-readable snapshot name
  detail: text("detail"),                  // JSON or description of changes
  ipAddress: text("ip_address"),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  siteName: text("site_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== SIEM ====================
export const syslogSources = pgTable("syslog_sources", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  displayName: text("display_name").notNull(),
  vendor: syslogVendorEnum("vendor").notNull().default("generic"),
  product: text("product"),
  parserProfile: text("parser_profile").notNull().default("generic"),
  trustLevel: syslogTrustLevelEnum("trust_level").notNull().default("unknown"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  eventCount: integer("event_count").notNull().default(0),
  rawRetentionDays: integer("raw_retention_days"),
  eventRetentionDays: integer("event_retention_days"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  siteSourceIpIdx: index("syslog_sources_site_source_ip_idx").on(table.siteId, table.sourceIp),
  sourceIpUnique: uniqueIndex("syslog_sources_source_ip_unique").on(table.sourceIp),
  hostnameIdx: index("syslog_sources_hostname_idx").on(table.hostname),
  deviceIdIdx: index("syslog_sources_device_id_idx").on(table.deviceId),
  enabledIdx: index("syslog_sources_enabled_idx").on(table.enabled),
}));

export const syslogEventsRaw = pgTable("syslog_events_raw", {
  id: serial("id").primaryKey(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  sourceIp: text("source_ip").notNull(),
  sourcePort: integer("source_port").notNull(),
  transport: syslogTransportEnum("transport").notNull().default("udp"),
  rawMessage: text("raw_message").notNull(),
  rawSize: integer("raw_size").notNull(),
  ingestStatus: syslogIngestStatusEnum("ingest_status").notNull().default("received"),
  parseError: text("parse_error"),
  // ponytail: nullable at insert — the receiver writes raw rows before any
  // source/site match (it only knows sourceIp). The parser worker stamps
  // siteId when it parses (or leaves it null for dropped rows). Per-site raw
  // deletes filter eq(siteId) so unparsed null-site rows are skipped and
  // cleaned by the global orphan-raw path. NOT NULL would force a per-event
  // source lookup on the syslog hot path; upgrade when receiver does the match.
  // Note: 0024 backfilled pre-existing NULL rows to the MIN active site id when
  // the source_ip could not be matched, so rows parked on that site may be
  // mis-attributed legacy data — see scripts/audit-site-backfill.sql.
  siteId: integer("site_id").references(() => sites.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  receivedAtIdx: index("syslog_events_raw_received_at_idx").on(table.receivedAt),
  sourceReceivedIdx: index("syslog_events_raw_source_received_idx").on(table.sourceIp, table.receivedAt),
  statusReceivedIdx: index("syslog_events_raw_status_received_idx").on(table.ingestStatus, table.receivedAt),
  siteReceivedIdx: index("syslog_events_raw_site_received_idx").on(table.siteId, table.receivedAt),
}));

export const syslogEvents = pgTable("syslog_events", {
  id: serial("id").primaryKey(),
  // Plain integer by design: migration 0016 partitioned syslog_events_raw and
  // dropped this FK. PostgreSQL forbids a regular FK referencing a partitioned
  // table, so the raw_event_id FK can never be re-created. The reference is
  // maintained by the application layer (lib/siem/evidence.ts). No
  // .references() and no Drizzle relation — the ORM must not claim an FK that
  // does not exist in the database. The legal referencing-side FKs (site_id,
  // device_id, source_id) were restored by migration 0035.
  rawEventId: integer("raw_event_id").notNull(),
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  facility: integer("facility"),
  severity: integer("severity"),
  priority: integer("priority"),
  appName: text("app_name"),
  program: text("program"),
  processId: text("process_id"),
  message: text("message").notNull(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  vendor: syslogVendorEnum("vendor"),
  parser: text("parser").notNull(),
  category: text("category"),
  normalizedType: text("normalized_type"),
  action: text("action"),
  outcome: text("outcome"),
  srcIp: text("src_ip"),
  srcPort: integer("src_port"),
  dstIp: text("dst_ip"),
  dstPort: integer("dst_port"),
  username: text("username"),
  interfaceName: text("interface_name"),
  protocol: text("protocol"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  receivedAtIdx: index("syslog_events_received_at_idx").on(table.receivedAt),
  siteReceivedIdx: index("syslog_events_site_received_idx").on(table.siteId, table.receivedAt),
  deviceReceivedIdx: index("syslog_events_device_received_idx").on(table.deviceId, table.receivedAt),
  sourceReceivedIdx: index("syslog_events_source_received_idx").on(table.sourceIp, table.receivedAt),
  normalizedReceivedIdx: index("syslog_events_normalized_received_idx").on(table.normalizedType, table.receivedAt),
  severityReceivedIdx: index("syslog_events_severity_received_idx").on(table.severity, table.receivedAt),
  categoryReceivedIdx: index("syslog_events_category_received_idx").on(table.category, table.receivedAt),
}));

export const siemRules = pgTable("siem_rules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  severity: incidentSeverityEnum("severity").notNull(),
  category: text("category").notNull(),
  ruleType: siemRuleTypeEnum("rule_type").notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  groupBy: jsonb("group_by").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  threshold: integer("threshold"),
  windowSeconds: integer("window_seconds"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  alertEnabled: boolean("alert_enabled").notNull().default(false),
  // 0024 backfilled NULL site_ids to the min active site id, then 0025 locked
  // this column NOT NULL — rows parked on the min-site may be mis-attributed
  // legacy data (see scripts/audit-site-backfill.sql for a review pass).
  siteId: integer("site_id").references(() => sites.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  siteKeyUnique: uniqueIndex("siem_rules_site_key_unique").on(table.siteId, table.key),
  siteEnabledIdx: index("siem_rules_site_enabled_idx").on(table.siteId, table.enabled),
  enabledIdx: index("siem_rules_enabled_idx").on(table.enabled),
  categoryIdx: index("siem_rules_category_idx").on(table.category),
  severityIdx: index("siem_rules_severity_idx").on(table.severity),
}));

export const siemFindings = pgTable("siem_findings", {
  id: serial("id").primaryKey(),
  // 0024 backfilled this column for rows whose event/source mapping could not
  // be resolved (fallback = min active site id); 0025 then set NOT NULL, so
  // fallback-assigned rows are indistinguishable from genuine ones — see
  // scripts/audit-site-backfill.sql.
  siteId: integer("site_id").references(() => sites.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  ruleId: integer("rule_id").references(() => siemRules.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  humanAnalysis: text("human_analysis"),
  recommendedAction: text("recommended_action"),
  aiAnalysis: jsonb("ai_analysis").$type<Record<string, unknown> | null>(),
  aiGeneratedAt: timestamp("ai_generated_at"),
  severity: incidentSeverityEnum("severity").notNull(),
  status: siemFindingStatusEnum("status").notNull().default("Open"),
  eventCount: integer("event_count").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  sampleEventIds: jsonb("sample_event_ids").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  evidenceArchived: boolean("evidence_archived").notNull().default(false),
  correlationKey: text("correlation_key").notNull(),
  acknowledgedBy: integer("acknowledged_by").references(() => users.id),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: integer("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdIncidentId: integer("created_incident_id").references(() => incidents.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusSeverityLastSeenIdx: index("siem_findings_status_severity_last_seen_idx").on(table.status, table.severity, table.lastSeenAt),
  siteStatusSeverityIdx: index("siem_findings_site_status_severity_idx").on(table.siteId, table.status, table.severity),
  deviceStatusIdx: index("siem_findings_device_status_idx").on(table.deviceId, table.status),
  siteRuleCorrelationUnique: uniqueIndex("siem_findings_site_rule_correlation_unique").on(table.siteId, table.ruleId, table.correlationKey),
}));

export const siemAlerts = pgTable("siem_alerts", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id).notNull(),
  channel: siemAlertChannelEnum("channel").notNull(),
  recipient: text("recipient"),
  status: siemAlertStatusEnum("status").notNull().default("pending"),
  message: text("message").notNull(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  findingIdx: index("siem_alerts_finding_idx").on(table.findingId),
  statusCreatedIdx: index("siem_alerts_status_created_idx").on(table.status, table.createdAt),
}));

// PIC alert email history (lib/email.ts): one row per email sent from a
// checklist submit. device_count + device_summary snapshot the NOT-OK devices
// in that email (one PIC gets one email listing all their devices), so there
// is no per-device FK. Written once by the inline sender (sent/failed);
// 'pending' exists only for a future retry worker.
export const emailAlerts = pgTable("email_alerts", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }).notNull(),
  entryId: integer("entry_id").references(() => checklistEntries.id, { onDelete: "set null" }),
  recipient: text("recipient").notNull(),
  recipientName: text("recipient_name"),
  subject: text("subject").notNull(),
  deviceCount: integer("device_count").notNull().default(0),
  deviceSummary: text("device_summary"),
  status: emailAlertStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  siteCreatedIdx: index("email_alerts_site_created_idx").on(table.siteId, table.createdAt),
  statusCreatedIdx: index("email_alerts_status_created_idx").on(table.status, table.createdAt),
}));

export const siemAiJobs = pgTable("siem_ai_jobs", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id, { onDelete: "cascade" }).notNull(),
  status: siemAiJobStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  findingIdx: index("siem_ai_jobs_finding_idx").on(table.findingId),
  statusCreatedIdx: index("siem_ai_jobs_status_created_idx").on(table.status, table.createdAt),
}));

export const siemSettings = pgTable("siem_settings", {
  id: serial("id").primaryKey(),
  // 0024 backfilled every pre-existing NULL row to the min active site id (no
  // source mapping exists for settings); 0025 then set NOT NULL — see
  // scripts/audit-site-backfill.sql.
  siteId: integer("site_id").references(() => sites.id).notNull(),
  udpPort: integer("udp_port").notNull().default(514),
  tcpPort: integer("tcp_port"),
  tlsPort: integer("tls_port"),
  tlsCertPath: text("tls_cert_path"),
  tlsKeyPath: text("tls_key_path"),
  maxMessageSize: integer("max_message_size").notNull().default(16384),
  queueLimit: integer("queue_limit").notNull().default(1000),
  batchSize: integer("batch_size").notNull().default(100),
  flushIntervalMs: integer("flush_interval_ms").notNull().default(1000),
  rawRetentionDays: integer("raw_retention_days").notNull().default(90),
  eventRetentionDays: integer("event_retention_days").notNull().default(180),
  findingRetentionDays: integer("finding_retention_days").notNull().default(365),
  alertRetentionDays: integer("alert_retention_days").notNull().default(365),
  alertMinSeverity: incidentSeverityEnum("alert_min_severity").notNull().default("High"),
  quarantineEnabled: boolean("quarantine_enabled").notNull().default(true),
  quarantineRetentionDays: integer("quarantine_retention_days").notNull().default(365),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  aiEndpointUrl: text("ai_endpoint_url"),
  aiApiKey: text("ai_api_key"),
  aiDefaultModel: text("ai_default_model"),
  aiMaxSampleEvents: integer("ai_max_sample_events").notNull().default(5),
  aiMaxRawLength: integer("ai_max_raw_length").notNull().default(2000),
  aiRegenerateCooldownSec: integer("ai_regenerate_cooldown_sec").notNull().default(3600),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  siteUnique: uniqueIndex("siem_settings_site_unique").on(table.siteId),
}));

export const siemEventsQuarantine = pgTable("siem_events_quarantine", {
  id: serial("id").primaryKey(),
  originalEventId: integer("original_event_id").notNull(),
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  message: text("message").notNull(),
  severity: integer("severity"),
  rawEventId: integer("raw_event_id"),
  // 0024 backfilled this column (original_event_id lookup, else fallback to
  // min active site id); 0025 then set NOT NULL — see
  // scripts/audit-site-backfill.sql.
  siteId: integer("site_id").references(() => sites.id).notNull(),
  quarantinedAt: timestamp("quarantined_at").defaultNow(),
  quarantinedReason: text("quarantined_reason"),
}, (table) => ({
  receivedAtIdx: index("siem_events_quarantine_received_at_idx").on(table.receivedAt),
  quarantinedAtIdx: index("siem_events_quarantine_quarantined_at_idx").on(table.quarantinedAt),
  siteQuarantinedIdx: index("siem_events_quarantine_site_quarantined_idx").on(table.siteId, table.quarantinedAt),
}));

// ==================== SIEM DASHBOARD SNAPSHOTS (N24) ====================
// Hourly snapshots of the seven SIEM dashboard counters. Populated by the
// siem-snapshot worker (or lazy from the dashboard action) and read by
// getSiemDashboardStats to build 24h/7d/30d time-series for the charts.
export const siemDashboardSnapshots = pgTable("siem_dashboard_snapshots", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  raw24h: integer("raw_24h").notNull().default(0),
  parsed24h: integer("parsed_24h").notNull().default(0),
  openFindings: integer("open_findings").notNull().default(0),
  criticalFindings: integer("critical_findings").notNull().default(0),
  unmappedSources: integer("unmapped_sources").notNull().default(0),
  pendingAlerts: integer("pending_alerts").notNull().default(0),
  failedAlerts: integer("failed_alerts").notNull().default(0),
}, (table) => ({
  capturedAtIdx: index("siem_dashboard_snapshots_captured_at_idx").on(table.capturedAt),
  siteCapturedIdx: index("siem_dashboard_snapshots_site_captured_idx").on(table.siteId, table.capturedAt),
}));

export const siemEvidenceEvents = pgTable("siem_evidence_events", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id).notNull(),
  originalEventId: integer("original_event_id").notNull(),
  eventTime: timestamp("event_time"),
  receivedAt: timestamp("received_at").notNull(),
  sourceIp: text("source_ip").notNull(),
  hostname: text("hostname"),
  deviceId: integer("device_id").references(() => devices.id),
  sourceId: integer("source_id").references(() => syslogSources.id),
  message: text("message").notNull(),
  rawMessage: text("raw_message"),
  category: text("category"),
  normalizedType: text("normalized_type"),
  action: text("action"),
  outcome: text("outcome"),
  srcIp: text("src_ip"),
  dstIp: text("dst_ip"),
  username: text("username"),
  severity: integer("severity"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  archivedAt: timestamp("archived_at").defaultNow(),
}, (table) => ({
  findingIdx: index("siem_evidence_events_finding_idx").on(table.findingId),
  originalIdx: index("siem_evidence_events_original_idx").on(table.originalEventId),
  findingOriginalUnique: uniqueIndex("siem_evidence_events_finding_id_original_event_id_unique").on(table.findingId, table.originalEventId),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  site: one(sites, {
    fields: [auditLogs.siteId],
    references: [sites.id],
  }),
}));

export const syslogSourcesRelations = relations(syslogSources, ({ one, many }) => ({
  site: one(sites, {
    fields: [syslogSources.siteId],
    references: [sites.id],
  }),
  device: one(devices, {
    fields: [syslogSources.deviceId],
    references: [devices.id],
  }),
  events: many(syslogEvents),
  findings: many(siemFindings),
}));

export const syslogEventsRawRelations = relations(syslogEventsRaw, ({ one }) => ({
  site: one(sites, {
    fields: [syslogEventsRaw.siteId],
    references: [sites.id],
  }),
}));

export const syslogEventsRelations = relations(syslogEvents, ({ one }) => ({
  source: one(syslogSources, {
    fields: [syslogEvents.sourceId],
    references: [syslogSources.id],
  }),
  site: one(sites, {
    fields: [syslogEvents.siteId],
    references: [sites.id],
  }),
  device: one(devices, {
    fields: [syslogEvents.deviceId],
    references: [devices.id],
  }),
}));

export const siemRulesRelations = relations(siemRules, ({ one, many }) => ({
  site: one(sites, {
    fields: [siemRules.siteId],
    references: [sites.id],
  }),
  findings: many(siemFindings),
}));

export const siemFindingsRelations = relations(siemFindings, ({ one, many }) => ({
  rule: one(siemRules, {
    fields: [siemFindings.ruleId],
    references: [siemRules.id],
  }),
  source: one(syslogSources, {
    fields: [siemFindings.sourceId],
    references: [syslogSources.id],
  }),
  device: one(devices, {
    fields: [siemFindings.deviceId],
    references: [devices.id],
  }),
  site: one(sites, {
    fields: [siemFindings.siteId],
    references: [sites.id],
  }),
  acknowledgedBy: one(users, {
    fields: [siemFindings.acknowledgedBy],
    references: [users.id],
    relationName: "acknowledgedSiemFindings",
  }),
  resolvedBy: one(users, {
    fields: [siemFindings.resolvedBy],
    references: [users.id],
    relationName: "resolvedSiemFindings",
  }),
  alerts: many(siemAlerts),
}));

export const siemEvidenceEventsRelations = relations(siemEvidenceEvents, ({ one }) => ({
  finding: one(siemFindings, {
    fields: [siemEvidenceEvents.findingId],
    references: [siemFindings.id],
  }),
}));

export const siemAlertsRelations = relations(siemAlerts, ({ one }) => ({
  finding: one(siemFindings, {
    fields: [siemAlerts.findingId],
    references: [siemFindings.id],
  }),
}));

export const siemSettingsRelations = relations(siemSettings, ({ one }) => ({
  site: one(sites, {
    fields: [siemSettings.siteId],
    references: [sites.id],
    relationName: "siemSettingsSite",
  }),
}));

