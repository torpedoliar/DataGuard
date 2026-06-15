CREATE TABLE "site_telegram_chat_ids" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"chat_id" text NOT NULL,
	"label" text NOT NULL,
	"severity_filter" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "site_telegram_chat_ids" ADD CONSTRAINT "site_telegram_chat_ids_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_telegram_chat_ids_site_id_idx" ON "site_telegram_chat_ids" USING btree ("site_id");
