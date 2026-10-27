CREATE TABLE `chat_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Each project's single codebase thread becomes its first history entry, titled by its first question.
INSERT INTO `chat_threads`("project_id", "title", "created_at", "updated_at")
SELECT "project_id", coalesce(substr(json_extract("message", '$.parts[0].text'), 1, 80), 'Earlier conversation'), CAST(strftime('%s', 'now') AS integer), CAST(strftime('%s', 'now') AS integer)
FROM `chat_messages` WHERE "project_id" IS NOT NULL AND "position" = 0;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` integer,
	`thread_id` integer,
	`position` integer NOT NULL,
	`message` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Row ids move from "p<project>:<message>" to "t<thread>:<message>".
INSERT INTO `__new_chat_messages`("id", "review_id", "thread_id", "position", "message")
SELECT
	CASE WHEN t."id" IS NULL THEN m."id" ELSE 't' || t."id" || ':' || substr(m."id", instr(m."id", ':') + 1) END,
	m."review_id", t."id", m."position", m."message"
FROM `chat_messages` m LEFT JOIN `chat_threads` t ON t."project_id" = m."project_id";
--> statement-breakpoint
DROP TABLE `chat_messages`;--> statement-breakpoint
ALTER TABLE `__new_chat_messages` RENAME TO `chat_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
