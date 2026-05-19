CREATE TYPE "public"."incident_severity" AS ENUM('Low', 'Medium', 'High', 'Critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('Open', 'In Progress', 'Resolved', 'Verified');--> statement-breakpoint
CREATE TYPE "public"."incident_update_type" AS ENUM('created', 'assigned', 'status_changed', 'comment', 'evidence');--> statement-breakpoint
CREATE TYPE "public"."resolution_action" AS ENUM('Replaced', 'Reconfigured', 'Restarted', 'Cleaned', 'Escalated', 'No Action Needed');--> statement-breakpoint
CREATE TYPE "public"."resolution_category" AS ENUM('Hardware', 'Power', 'Network', 'Environment', 'Human Error', 'False Alarm', 'Other');--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"incident_id" integer NOT NULL,
	"author_id" integer,
	"update_type" "incident_update_type" NOT NULL,
	"note" text,
	"photo_path" text,
	"previous_status" "incident_status",
	"new_status" "incident_status",
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"checklist_item_id" integer,
	"title" text NOT NULL,
	"description" text,
	"severity" "incident_severity" DEFAULT 'Medium' NOT NULL,
	"status" "incident_status" DEFAULT 'Open' NOT NULL,
	"created_by_id" integer,
	"assigned_to_id" integer,
	"due_date" timestamp,
	"resolution_category" "resolution_category",
	"resolution_action" "resolution_action",
	"resolved_by_id" integer,
	"resolved_at" timestamp,
	"verified_by_id" integer,
	"verified_at" timestamp,
	"last_overdue_notified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_checklist_item_id_unique" ON "incidents" USING btree ("checklist_item_id");