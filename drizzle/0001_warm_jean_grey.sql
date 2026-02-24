ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `is_active` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);