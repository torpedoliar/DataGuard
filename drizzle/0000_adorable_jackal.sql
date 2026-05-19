CREATE TYPE "public"."media_type" AS ENUM('Copper (RJ45)', 'Fiber (SFP/SFP+)', 'Twinax (DAC)');--> statement-breakpoint
CREATE TYPE "public"."port_mode" AS ENUM('Access', 'Trunk', 'Routed', 'LACP');--> statement-breakpoint
CREATE TYPE "public"."port_status" AS ENUM('Active', 'Inactive', 'Down');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('superadmin', 'admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."role_in_site" AS ENUM('admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."shift" AS ENUM('Pagi', 'Siang', 'Malam');--> statement-breakpoint
CREATE TYPE "public"."speed" AS ENUM('10/100M', '1G', '10G', '25G', '40G', '100G', 'Auto');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('OK', 'Warning', 'Error');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"username" text,
	"user_role" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" integer,
	"entity_name" text,
	"detail" text,
	"ip_address" text,
	"site_id" integer,
	"site_name" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#3b82f6',
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "checklist_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"user_id" integer NOT NULL,
	"check_date" text NOT NULL,
	"check_time" text NOT NULL,
	"shift" "shift" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"status" "status" NOT NULL,
	"remarks" text,
	"photo_path" text
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"brand_id" integer,
	"location" text DEFAULT '' NOT NULL,
	"location_id" integer,
	"rack_name" text,
	"rack_position" integer,
	"u_height" integer DEFAULT 1,
	"zone" text,
	"ip_address" text,
	"description" text,
	"photo_path" text,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_name" text DEFAULT 'DataGuard' NOT NULL,
	"logo_path" text,
	"favicon_path" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "network_ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"port_name" text NOT NULL,
	"mac_address" text,
	"ip_address" text,
	"port_mode" "port_mode",
	"vlan_id" integer,
	"trunk_vlans" text,
	"status" "port_status",
	"speed" "speed",
	"media_type" "media_type",
	"connected_to_device_id" integer,
	"connected_to_port_id" integer,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"name" text NOT NULL,
	"zone" text,
	"total_u" integer DEFAULT 42,
	"location" text,
	"location_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"description" text,
	"telegram_chat_id" text,
	"latitude" text,
	"longitude" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"site_id" integer NOT NULL,
	"role_in_site" "role_in_site" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"role" "role" DEFAULT 'staff' NOT NULL,
	"password_hash" text NOT NULL,
	"photo_path" text,
	"is_active" boolean DEFAULT true,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vlans" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer,
	"vlan_id" integer NOT NULL,
	"name" text NOT NULL,
	"subnet" text,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_entries" ADD CONSTRAINT "checklist_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_entries" ADD CONSTRAINT "checklist_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_entry_id_checklist_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."checklist_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_ports" ADD CONSTRAINT "network_ports_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_ports" ADD CONSTRAINT "network_ports_vlan_id_vlans_id_fk" FOREIGN KEY ("vlan_id") REFERENCES "public"."vlans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_ports" ADD CONSTRAINT "network_ports_connected_to_device_id_devices_id_fk" FOREIGN KEY ("connected_to_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_ports" ADD CONSTRAINT "network_ports_connected_to_port_id_network_ports_id_fk" FOREIGN KEY ("connected_to_port_id") REFERENCES "public"."network_ports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sites" ADD CONSTRAINT "user_sites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vlans" ADD CONSTRAINT "vlans_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;