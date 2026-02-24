CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`logo_path` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_unique` ON `brands` (`name`);--> statement-breakpoint
CREATE TABLE `network_ports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`port_name` text NOT NULL,
	`mac_address` text,
	`ip_address` text,
	`port_mode` text,
	`vlan_id` integer,
	`trunk_vlans` text,
	`status` text,
	`speed` text,
	`media_type` text,
	`connected_to_device_id` integer,
	`connected_to_port_id` integer,
	`description` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vlan_id`) REFERENCES `vlans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connected_to_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connected_to_port_id`) REFERENCES `network_ports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vlans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vlan_id` integer NOT NULL,
	`name` text NOT NULL,
	`subnet` text,
	`description` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vlans_vlan_id_unique` ON `vlans` (`vlan_id`);--> statement-breakpoint
ALTER TABLE `categories` ADD `color` text DEFAULT '#3b82f6';--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
ALTER TABLE `devices` ADD `brand_id` integer REFERENCES brands(id);--> statement-breakpoint
ALTER TABLE `devices` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `devices` ADD `description` text;