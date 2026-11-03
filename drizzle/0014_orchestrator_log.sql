ALTER TABLE `reviews` ADD `activity` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `trace` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_units` ADD `agent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `review_units` ADD `steps` text DEFAULT '' NOT NULL;