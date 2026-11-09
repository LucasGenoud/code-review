CREATE TABLE `code_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`model` text NOT NULL,
	`path` text NOT NULL,
	`version` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`vector` blob NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_chunks_project_model_path` ON `code_chunks` (`project_id`,`model`,`path`);
