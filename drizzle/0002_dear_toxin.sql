ALTER TABLE `devices` ADD `rack_name` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `rack_position` integer;--> statement-breakpoint
ALTER TABLE `devices` ADD `u_height` integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE `devices` ADD `zone` text;