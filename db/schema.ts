import { sql, relations } from "drizzle-orm";
import { integer, pgTable, text, serial, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
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
}));

export const usersRelations = relations(users, ({ many }) => ({
  checklistEntries: many(checklistEntries),
  userSites: many(userSites),
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

