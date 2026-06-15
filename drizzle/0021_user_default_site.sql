ALTER TABLE "users" ADD COLUMN "default_site_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_site_id_sites_id_fk" FOREIGN KEY ("default_site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
