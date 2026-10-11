-- Preserve existing instructions as descriptions and initial names.
ALTER TABLE `rules` ADD `name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `rules` SET `name` = `text`;
--> statement-breakpoint
ALTER TABLE `rule_overrides` ADD `name` text;
--> statement-breakpoint
ALTER TABLE `rule_changes` ADD `name` text;
--> statement-breakpoint
UPDATE `rule_changes` SET `name` = `text` WHERE `text` IS NOT NULL;
--> statement-breakpoint
-- Upgrade frozen snapshots using their own text, never today's rules.
UPDATE `reviews` SET `rules` = json_set(`rules`, '$.categories', json((
  SELECT json_group_array(json_set(category.value, '$.rules', json((
    SELECT json_group_array(json_remove(json_set(rule.value,
      '$.name', json_extract(rule.value, '$.text'),
      '$.description', json_extract(rule.value, '$.text')
    ), '$.text'))
    FROM json_each(category.value, '$.rules') AS rule
  ))))
  FROM json_each(reviews.rules, '$.categories') AS category
)));
