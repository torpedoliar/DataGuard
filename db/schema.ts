import { sql, relations } from "drizzle-orm";
import { integer, sqliteTable, text, AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// ==================== SITES (NEW) ====================
export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").unique().notNull(), // short code e.g. "DC-JKT", "DC-SBY"
  address: text("address"),
  description: text("description"),
  telegramChatId: text("telegram_chat_id"),
  latitude: text("latitude"),   // e.g. "-6.2088"
  longitude: text("longitude"), // e.g. "106.8456"
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== USERS ====================
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").unique().notNull(),
  email: text("email").unique(),
  role: text("role", { enum: ["superadmin", "admin", "staff"] }).notNull().default("staff"),
  passwordHash: text("password_hash").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  lastLogin: integer("last_login", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== USER-SITE ASSIGNMENT (NEW) ====================
export const userSites = sqliteTable("user_sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id).notNull(),
  siteId: integer("site_id").references(() => sites.id).notNull(),
  roleInSite: text("role_in_site", { enum: ["admin", "staff"] }).notNull().default("staff"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== CATEGORIES (GLOBAL) ====================
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").default("#3b82f6"),
});

// ==================== LOCATIONS (PER SITE) ====================
export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== RACKS (PER SITE) ====================
export const racks = sqliteTable("racks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").references(() => sites.id),
  name: text("name").notNull(),
  zone: text("zone"),
  totalU: integer("total_u").default(42),
  location: text("location"),
  locationId: integer("location_id").references(() => locations.id),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== BRANDS (GLOBAL) ====================
export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  logoPath: text("logo_path"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== DEVICES (PER SITE) ====================
export const devices = sqliteTable("devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
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
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

// ==================== CHECKLIST ENTRIES (PER SITE) ====================
export const checklistEntries = sqliteTable("checklist_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").references(() => sites.id),
  userId: integer("user_id").references(() => users.id).notNull(),
  checkDate: text("check_date").notNull(),
  checkTime: text("check_time").notNull(),
  shift: text("shift", { enum: ["Pagi", "Siang", "Malam"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const checklistItems = sqliteTable("checklist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: integer("entry_id").references(() => checklistEntries.id).notNull(),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  status: text("status", { enum: ["OK", "Warning", "Error"] }).notNull(),
  remarks: text("remarks"),
  photoPath: text("photo_path"),
});

// ==================== VLANS (PER SITE) ====================
export const vlans = sqliteTable("vlans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").references(() => sites.id),
  vlanId: integer("vlan_id").notNull(),
  name: text("name").notNull(),
  subnet: text("subnet"),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

// ==================== NETWORK PORTS (PER SITE via device) ====================
export const networkPorts = sqliteTable("network_ports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: integer("device_id").references(() => devices.id).notNull(),
  portName: text("port_name").notNull(),
  macAddress: text("mac_address"),
  ipAddress: text("ip_address"),
  portMode: text("port_mode", { enum: ["Access", "Trunk", "Routed", "LACP"] }),
  vlanId: integer("vlan_id").references(() => vlans.id),
  trunkVlans: text("trunk_vlans"),
  status: text("status", { enum: ["Active", "Inactive", "Down"] }),
  speed: text("speed", { enum: ["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"] }),
  mediaType: text("media_type", { enum: ["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"] }),
  connectedToDeviceId: integer("connected_to_device_id").references(() => devices.id),
  connectedToPortId: integer("connected_to_port_id").references((): AnySQLiteColumn => networkPorts.id),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
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

// ==================== GLOBAL SETTINGS (NEW) ====================
export const globalSettings = sqliteTable("global_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appName: text("app_name").notNull().default("DataGuard"),
  logoPath: text("logo_path"),
  faviconPath: text("favicon_path"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});
