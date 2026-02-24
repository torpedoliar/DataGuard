CREATE TABLE `racks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`zone` text,
	`total_u` integer DEFAULT 42,
	`location` text,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `racks_name_unique` ON `racks` (`name`);