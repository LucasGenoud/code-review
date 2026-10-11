-- Built-in "Bugs" category: reviewed in its own pass, can't be deleted.
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `position`)
VALUES ('bugs', 'Bugs', 'red', 'Defects that make the code behave incorrectly. Each finding must describe a concrete failure.', 0);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT `id`, r.`text`, r.`severity`, r.`position`
FROM `categories`, (
  SELECT 'Null, undefined or missing-key access that can crash or misbehave' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Off-by-one and boundary errors in loops, slices, ranges and comparisons', 'major', 1
  UNION ALL SELECT 'Division by zero or operations on empty input', 'major', 2
  UNION ALL SELECT 'Errors swallowed, ignored or left unhandled', 'major', 3
  UNION ALL SELECT 'Resources not released: files, connections, locks, subscriptions', 'major', 4
  UNION ALL SELECT 'Inverted, wrong or unreachable conditions', 'major', 5
  UNION ALL SELECT 'Async misuse and race conditions: missing await, shared state across concurrent calls', 'major', 6
  UNION ALL SELECT 'Type or unit mismatches, e.g. money as float, cents vs units, seconds vs ms', 'major', 7
  UNION ALL SELECT 'Shared mutable state that leaks between calls, e.g. mutable default arguments', 'major', 8
  UNION ALL SELECT 'Injection: SQL, shell, path or HTML built from untrusted input', 'critical', 9
  UNION ALL SELECT 'Any other defect that makes the code behave incorrectly', 'major', 10
) AS r
WHERE `categories`.`kind` = 'bugs';
