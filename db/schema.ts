import { sql, relations } from "drizzle-orm";
import { integer, pgTable, text, serial, boolean, timestamp, pgEnum, uniqueIndex, jsonb, index } from "drizzle-orm/pg-core";
import { AnyPgColumn } from "drizzle-orm/pg-core";

// ==================== ENUMS ====================
export const roleEnum = pgEnum("role", ["superadmin", "admin", "staff"]);
export const roleInSiteEnum = pgEnum("role_in_site", ["admin", "staff"]);
export const shiftEnum = pgEnum("shift", ["Pagi", "Siang", "Malam"]);
export const statusEnum = pgEnum("status", ["OK", "Warning", "Error"]);
export const portModeEnum = pgEnum("port_mode", ["Access", "Trunk", "Routed", "LACP"]);
export const portStatusEnum = pgEnum("port_status", ["Active", "Inactive", "Down"]);
export const speedEnum = pgEnum("speed", ["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"]);
export const mediaTypeEnum = pgEnum("media_type", ["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"]);
export const incidentSeverityEnum = pgEnum("incident_severity", ["Low", "Medium", "High", "Critical"]);
export const incidentStatusEnum = pgEnum("incident_status", ["Open", "In Progress", "Resolved", "Verified"]);
export const incidentUpdateTypeEnum = pgEnum("incident_update_type", ["created", "assigned", "status_changed", "comment", "evidence"]);
export const resolutionCategoryEnum = pgEnum("resolution_category", ["Hardware", "Power", "Network", "Environment", "Human Error", "False Alarm", "Other"]);
export const resolutionActionEnum = pgEnum("resolution_action", ["Replaced", "Reconfigured", "Restarted", "Cleaned", "Escalated", "No Action Needed"]);
export const syslogTransportEnum = pgEnum("syslog_transport", ["udp", "tcp", "tls"]);
export const syslogIngestStatusEnum = pgEnum("syslog_ingest_status", ["received", "parsed", "parse_failed", "dropped"]);
export const syslogVendorEnum = pgEnum("syslog_vendor", ["generic", "mikrotik", "cisco", "fortigate", "linux"]);
export const syslogTrustLevelEnum = pgEnum("syslog_trust_level", ["unknown", "trusted", "untrusted"]);
export const siemRuleTypeEnum = pgEnum("siem_rule_type", ["single_event", "threshold", "sequence", "absence", "baseline_anomaly"]);
export const siemFindingStatusEnum = pgEnum("siem_finding_status", ["Open", "Acknowledged", "Resolved"]);
export const siemAlertChannelEnum = pgEnum("siem_alert_channel", ["telegram", "email", "webhook"]);
export const siemAlertStatusEnum = pgEnum("siem_alert_status", ["pending", "sent", "failed"]);

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

// ==================== USERS ====================
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  email: text("email").unique(),
  role: roleEnum("role").notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  photoPath: text("photo_path"),
  isActive: boolean("is_active").default(true),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow(),
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
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== RACKS (PER SITE) ====================
export const racks = pgTable("racks", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  zone: text("zone"),
  totalU: integer("total_u").default(42),
  location: text("location"),
  locationId: integer("location_id").references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== BRANDS (GLOBAL) ====================
export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  logoPath: text("logo_path"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== DEVICES (PER SITE) ====================
export const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
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
});

// ==================== CHECKLIST ENTRIES (PER SITE) ====================
export const checklistEntries = pgTable("checklist_entries", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id),
  userId: integer("user_id").references(() => users.id).notNull(),
  checkDate: text("check_date").notNull(),
  checkTime: text("check_time").notNull(),
  shift: shiftEnum("shift").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const checklistItems = pgTable("checklist_items", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id").references(() => checklistEntries.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  status: statusEnum("status").notNull(),
  remarks: text("remarks"),
  photoPath: text("photo_path"),
});

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
  siemSettings: many(siemSettings),
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

// ==================== GLOBAL SETTINGS ====================
export const globalSettings = pgTable("global_settings", {
  id: serial("id").primaryKey(),
  appName: text("app_name").notNull().default("DataGuard"),
  logoPath: text("logo_path"),
  faviconPath: text("favicon_path"),
  telegramBotToken: text("telegram_bot_token"),
  telegramAlertTemplate: text("telegram_alert_template"),
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
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  deviceId: integer("device_id").references(() => devices.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  hostname: text("hostname"),
  vendor: syslogVendorEnum("vendor").notNull().default("generic"),
  transport: syslogTransportEnum("transport").notNull().default("udp"),
  port: integer("port").notNull().default(514),
  trustLevel: syslogTrustLevelEnum("trust_level").notNull().default("unknown"),
  parser: text("parser").notNull().default("generic"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  ipAddressIdx: index("syslog_sources_ip_address_idx").on(table.ipAddress),
  siteIdIdx: index("syslog_sources_site_id_idx").on(table.siteId),
  deviceIdIdx: index("syslog_sources_device_id_idx").on(table.deviceId),
  enabledIdx: index("syslog_sources_enabled_idx").on(table.enabled),
}));

export const syslogEventsRaw = pgTable("syslog_events_raw", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").references(() => syslogSources.id, { onDelete: "set null" }),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  transport: syslogTransportEnum("transport").notNull().default("udp"),
  sourceIp: text("source_ip").notNull(),
  sourcePort: integer("source_port"),
  rawMessage: text("raw_message").notNull(),
  ingestStatus: syslogIngestStatusEnum("ingest_status").notNull().default("received"),
  parseError: text("parse_error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  sourceIdIdx: index("syslog_events_raw_source_id_idx").on(table.sourceId),
  receivedAtIdx: index("syslog_events_raw_received_at_idx").on(table.receivedAt),
  sourceIpIdx: index("syslog_events_raw_source_ip_idx").on(table.sourceIp),
  ingestStatusIdx: index("syslog_events_raw_ingest_status_idx").on(table.ingestStatus),
}));

export const syslogEvents = pgTable("syslog_events", {
  id: serial("id").primaryKey(),
  rawEventId: integer("raw_event_id").references(() => syslogEventsRaw.id, { onDelete: "set null" }),
  sourceId: integer("source_id").references(() => syslogSources.id, { onDelete: "set null" }),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  deviceId: integer("device_id").references(() => devices.id, { onDelete: "set null" }),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  eventTimestamp: timestamp("event_timestamp"),
  vendor: syslogVendorEnum("vendor").notNull().default("generic"),
  facility: text("facility"),
  severity: integer("severity"),
  hostname: text("hostname"),
  appName: text("app_name"),
  processId: text("process_id"),
  message: text("message").notNull(),
  normalizedType: text("normalized_type").notNull().default("unknown"),
  sourceIp: text("source_ip"),
  sourcePort: integer("source_port"),
  destinationIp: text("destination_ip"),
  destinationPort: integer("destination_port"),
  username: text("username"),
  interfaceName: text("interface_name"),
  action: text("action"),
  outcome: text("outcome"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  rawEventIdIdx: index("syslog_events_raw_event_id_idx").on(table.rawEventId),
  sourceIdIdx: index("syslog_events_source_id_idx").on(table.sourceId),
  siteIdIdx: index("syslog_events_site_id_idx").on(table.siteId),
  deviceIdIdx: index("syslog_events_device_id_idx").on(table.deviceId),
  receivedAtIdx: index("syslog_events_received_at_idx").on(table.receivedAt),
  normalizedTypeIdx: index("syslog_events_normalized_type_idx").on(table.normalizedType),
  sourceIpIdx: index("syslog_events_source_ip_idx").on(table.sourceIp),
  usernameIdx: index("syslog_events_username_idx").on(table.username),
}));

export const siemRules = pgTable("siem_rules", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  severity: incidentSeverityEnum("severity").notNull().default("Medium"),
  type: siemRuleTypeEnum("type").notNull().default("single_event"),
  enabled: boolean("enabled").notNull().default(true),
  alertEnabled: boolean("alert_enabled").notNull().default(false),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  groupBy: jsonb("group_by").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  keyUnique: uniqueIndex("siem_rules_key_unique").on(table.key),
  categoryIdx: index("siem_rules_category_idx").on(table.category),
  enabledIdx: index("siem_rules_enabled_idx").on(table.enabled),
}));

export const siemFindings = pgTable("siem_findings", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").references(() => siemRules.id, { onDelete: "set null" }),
  sourceId: integer("source_id").references(() => syslogSources.id, { onDelete: "set null" }),
  deviceId: integer("device_id").references(() => devices.id, { onDelete: "set null" }),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  severity: incidentSeverityEnum("severity").notNull().default("Medium"),
  status: siemFindingStatusEnum("status").notNull().default("Open"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  eventCount: integer("event_count").notNull().default(1),
  groupKey: text("group_key"),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  acknowledgedById: integer("acknowledged_by_id").references(() => users.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedById: integer("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  ruleIdIdx: index("siem_findings_rule_id_idx").on(table.ruleId),
  sourceIdIdx: index("siem_findings_source_id_idx").on(table.sourceId),
  deviceIdIdx: index("siem_findings_device_id_idx").on(table.deviceId),
  siteIdIdx: index("siem_findings_site_id_idx").on(table.siteId),
  statusIdx: index("siem_findings_status_idx").on(table.status),
  severityIdx: index("siem_findings_severity_idx").on(table.severity),
  groupKeyIdx: index("siem_findings_group_key_idx").on(table.groupKey),
}));

export const siemAlerts = pgTable("siem_alerts", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id").references(() => siemFindings.id, { onDelete: "cascade" }).notNull(),
  ruleId: integer("rule_id").references(() => siemRules.id, { onDelete: "set null" }),
  channel: siemAlertChannelEnum("channel").notNull().default("telegram"),
  status: siemAlertStatusEnum("status").notNull().default("pending"),
  destination: text("destination"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  findingIdIdx: index("siem_alerts_finding_id_idx").on(table.findingId),
  ruleIdIdx: index("siem_alerts_rule_id_idx").on(table.ruleId),
  statusIdx: index("siem_alerts_status_idx").on(table.status),
  nextAttemptAtIdx: index("siem_alerts_next_attempt_at_idx").on(table.nextAttemptAt),
}));

export const siemSettings = pgTable("siem_settings", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id").references(() => sites.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  defaultAlertChannel: siemAlertChannelEnum("default_alert_channel").notNull().default("telegram"),
  telegramAlertsEnabled: boolean("telegram_alerts_enabled").notNull().default(false),
  maintenanceWindows: jsonb("maintenance_windows").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  trustedNetworks: jsonb("trusted_networks").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  parserSettings: jsonb("parser_settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  siteIdUnique: uniqueIndex("siem_settings_site_id_unique").on(table.siteId),
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
  rawEvents: many(syslogEventsRaw),
  events: many(syslogEvents),
  findings: many(siemFindings),
}));

export const syslogEventsRawRelations = relations(syslogEventsRaw, ({ one, many }) => ({
  source: one(syslogSources, {
    fields: [syslogEventsRaw.sourceId],
    references: [syslogSources.id],
  }),
  events: many(syslogEvents),
}));

export const syslogEventsRelations = relations(syslogEvents, ({ one }) => ({
  rawEvent: one(syslogEventsRaw, {
    fields: [syslogEvents.rawEventId],
    references: [syslogEventsRaw.id],
  }),
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

export const siemRulesRelations = relations(siemRules, ({ many }) => ({
  findings: many(siemFindings),
  alerts: many(siemAlerts),
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
    fields: [siemFindings.acknowledgedById],
    references: [users.id],
    relationName: "acknowledgedSiemFindings",
  }),
  resolvedBy: one(users, {
    fields: [siemFindings.resolvedById],
    references: [users.id],
    relationName: "resolvedSiemFindings",
  }),
  alerts: many(siemAlerts),
}));

export const siemAlertsRelations = relations(siemAlerts, ({ one }) => ({
  finding: one(siemFindings, {
    fields: [siemAlerts.findingId],
    references: [siemFindings.id],
  }),
  rule: one(siemRules, {
    fields: [siemAlerts.ruleId],
    references: [siemRules.id],
  }),
}));

export const siemSettingsRelations = relations(siemSettings, ({ one }) => ({
  site: one(sites, {
    fields: [siemSettings.siteId],
    references: [sites.id],
  }),
}));

