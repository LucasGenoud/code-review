-- Built-in language rule packs. Globs scope each pack to its files, so
-- multi-language projects get the right rules per file.
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'Python', 'blue', 'Python idioms and safety.', '**/*.py
**/*.pyi', 1);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'Use context managers (`with`) for files, locks and connections' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Use f-strings, not `%` formatting or `+` concatenation, to build strings', 'minor', 1
  UNION ALL SELECT 'Public functions have type hints for parameters and return value', 'minor', 2
  UNION ALL SELECT 'No wildcard imports (`from x import *`) and no unused imports', 'minor', 3
  UNION ALL SELECT 'Compare to None with `is None` / `is not None`, never `==`', 'minor', 4
  UNION ALL SELECT 'Use `logging`, not `print`, for diagnostics outside scripts', 'minor', 5
  UNION ALL SELECT 'Use `enumerate`/`zip` instead of `range(len(...))` indexing', 'info', 6
  UNION ALL SELECT 'Don''t shadow built-ins (`id`, `list`, `type`, `input`, `dict`...)', 'minor', 7
  UNION ALL SELECT 'Use dataclasses or NamedTuple for structured records, not raw dicts or tuples', 'info', 8
  UNION ALL SELECT 'Use `pathlib` rather than string manipulation for file paths', 'info', 9
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'Python';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'JavaScript', 'amber', 'JavaScript idioms and safety. Also applies to TypeScript files.', '**/*.js
**/*.jsx
**/*.mjs
**/*.cjs
**/*.ts
**/*.tsx
**/*.mts
**/*.cts', 2);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'Use `const` by default, `let` when reassigned, never `var`' AS `text`, 'minor' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Use strict equality (`===`, `!==`)', 'minor', 1
  UNION ALL SELECT 'Every Promise is awaited, returned or has a `.catch`: no floating promises', 'major', 2
  UNION ALL SELECT 'No `console.log` left in production code', 'minor', 3
  UNION ALL SELECT 'Prefer `async`/`await` over nested `.then` chains and callbacks', 'info', 4
  UNION ALL SELECT 'Use `?.` and `??` instead of `&&` chains and `||` defaults that break on 0 or ""', 'minor', 5
  UNION ALL SELECT 'No `eval`, `new Function` or string-based `setTimeout`', 'critical', 6
  UNION ALL SELECT 'Don''t mutate function arguments or shared objects; return new values', 'minor', 7
  UNION ALL SELECT 'Use template literals instead of string concatenation', 'info', 8
  UNION ALL SELECT 'No `innerHTML` or `dangerouslySetInnerHTML` with dynamic content', 'critical', 9
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'JavaScript';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'TypeScript', 'teal', 'TypeScript type safety. JavaScript rules apply to these files too.', '**/*.ts
**/*.tsx
**/*.mts
**/*.cts', 3);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'No `any`: use `unknown` and narrow' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'No non-null assertions (`!`) unless a comment states why the value can''t be null', 'minor', 1
  UNION ALL SELECT 'No `as` casts to silence type errors: narrow with type guards instead', 'minor', 2
  UNION ALL SELECT 'Exported functions declare their return type', 'info', 3
  UNION ALL SELECT 'Model fixed sets of values with union types or enums, not loose strings or numbers', 'minor', 4
  UNION ALL SELECT '`switch` over a union is exhaustive, with a `never` check in `default`', 'minor', 5
  UNION ALL SELECT 'Mark properties and arrays `readonly` when they aren''t meant to change', 'info', 6
  UNION ALL SELECT 'No `@ts-ignore`; use `@ts-expect-error` with a reason when unavoidable', 'minor', 7
  UNION ALL SELECT 'Use `import type` for type-only imports', 'info', 8
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'TypeScript';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'Java', 'orange', 'Java idioms and safety.', '**/*.java', 4);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'Use try-with-resources for every AutoCloseable' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Don''t catch `Exception` or `Throwable` broadly, and don''t swallow exceptions', 'major', 1
  UNION ALL SELECT 'Compare objects with `equals()`, not `==` (enums excepted)', 'major', 2
  UNION ALL SELECT 'Override `hashCode` whenever `equals` is overridden', 'major', 3
  UNION ALL SELECT 'Return empty collections or `Optional`, never `null`, for collection or optional results', 'minor', 4
  UNION ALL SELECT 'Fields are `private`, and `final` where possible', 'minor', 5
  UNION ALL SELECT 'Use `StringBuilder` when building strings in loops', 'info', 6
  UNION ALL SELECT 'No raw generic types (`List` instead of `List<String>`)', 'minor', 7
  UNION ALL SELECT 'No `Optional.get()` without a presence check; don''t use Optional for fields or parameters', 'minor', 8
  UNION ALL SELECT 'Use a logger, not `System.out` or `printStackTrace`', 'minor', 9
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'Java';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'Rust', 'slate', 'Rust idioms and safety.', '**/*.rs', 5);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'No `unwrap()`/`expect()` on runtime failures outside tests: propagate with `?`' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Libraries use typed error enums (e.g. `thiserror`); `anyhow` only in binaries', 'minor', 1
  UNION ALL SELECT 'Avoid needless `.clone()`: borrow where possible', 'minor', 2
  UNION ALL SELECT 'Every `unsafe` block has a `// SAFETY:` comment stating the invariants', 'critical', 3
  UNION ALL SELECT 'Take `&str`/`&[T]` parameters, not `&String`/`&Vec<T>`', 'info', 4
  UNION ALL SELECT 'No `panic!`, `todo!` or `unimplemented!` left in library code', 'major', 5
  UNION ALL SELECT 'Don''t discard a `Result` with `let _ =` without a comment explaining why', 'minor', 6
  UNION ALL SELECT 'Prefer `match`/`if let` over `is_some()` followed by `unwrap()`', 'minor', 7
  UNION ALL SELECT 'Public items have doc comments (`///`)', 'info', 8
  UNION ALL SELECT 'Prefer iterators over index loops when clearer', 'info', 9
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'Rust';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'HTML', 'pink', 'Semantic, accessible markup.', '**/*.html
**/*.htm', 6);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'Images have meaningful `alt` text (`alt=""` only for decorative images)' AS `text`, 'major' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Form inputs have an associated `<label>`', 'major', 1
  UNION ALL SELECT 'Use semantic elements (`button`, `nav`, `main`, `header`) instead of clickable `div`/`span`', 'major', 2
  UNION ALL SELECT 'Actions use `<button type=...>`; links have a real `href` (no `#` or `javascript:`)', 'minor', 3
  UNION ALL SELECT 'No inline `style` attributes or inline event handlers (`onclick=`)', 'minor', 4
  UNION ALL SELECT 'Heading levels are sequential, with one `h1` per page', 'minor', 5
  UNION ALL SELECT '`<html>` has `lang`; documents declare `<meta charset>` and viewport', 'minor', 6
  UNION ALL SELECT '`target="_blank"` links include `rel="noopener noreferrer"`', 'major', 7
  UNION ALL SELECT 'Custom interactive elements have a role, `tabindex` and keyboard handling', 'major', 8
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'HTML';
--> statement-breakpoint
INSERT INTO `categories` (`kind`, `name`, `color`, `description`, `globs`, `position`)
VALUES ('language', 'CSS', 'violet', 'Maintainable, accessible styles.', '**/*.css
**/*.scss
**/*.sass
**/*.less', 7);
--> statement-breakpoint
INSERT INTO `rules` (`category_id`, `text`, `severity`, `position`)
SELECT c.`id`, r.`text`, r.`severity`, r.`position`
FROM `categories` c, (
SELECT 'No `!important` except to override third-party styles' AS `text`, 'minor' AS `severity`, 0 AS `position`
  UNION ALL SELECT 'Use variables or tokens for colors, spacing and fonts, not repeated hard-coded values', 'minor', 1
  UNION ALL SELECT 'Keep selectors shallow (3 levels max); no ID selectors for styling', 'minor', 2
  UNION ALL SELECT 'Use relative units (`rem`, `em`, `%`) for font sizes and spacing', 'info', 3
  UNION ALL SELECT 'Don''t remove focus outlines without a visible replacement', 'major', 4
  UNION ALL SELECT 'Use flexbox or grid for layout, not floats or absolute-positioning hacks', 'minor', 5
  UNION ALL SELECT 'Wrap animations in `prefers-reduced-motion` checks', 'minor', 6
  UNION ALL SELECT 'Text colors meet WCAG AA contrast against their background', 'major', 7
  UNION ALL SELECT 'No duplicate properties and no vendor prefixes a build step adds', 'info', 8
) AS r
WHERE c.`kind` = 'language' AND c.`name` = 'CSS';
