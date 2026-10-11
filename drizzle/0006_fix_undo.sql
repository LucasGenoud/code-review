CREATE TABLE `applied_fixes` (
  `finding_id` integer PRIMARY KEY NOT NULL,
  `before` text NOT NULL,
  `after` text NOT NULL,
  `head_sha` text,
  `finding_states` text NOT NULL,
  FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON DELETE cascade
);
--> statement-breakpoint
-- Repair paths saved with Git's header terminator, preserving spaces.
UPDATE `review_files` SET `path` = rtrim(`path`, char(9)), `old_path` = rtrim(`old_path`, char(9));
--> statement-breakpoint
UPDATE `findings` SET `path` = rtrim(`path`, char(9));
