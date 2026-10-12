CREATE TABLE `rule_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`rule_ids` text NOT NULL,
	`created_at` integer NOT NULL
);
