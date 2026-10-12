#!/usr/bin/env node
// Compares eval runs by label, averaged over every result file per label,
// since single runs of the same setup differ by several issues.
//
// Usage: node eval/compare.mjs baseline usages
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESULTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

const labels = process.argv.slice(2);
if (labels.length === 0) {
  console.error("Usage: node eval/compare.mjs <label> [label…]");
  process.exit(1);
}

const pct = (x) => `${Math.round(100 * x)}%`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function load(label) {
  return fs
    .readdirSync(RESULTS)
    .filter((f) => f.endsWith(`-${label}.json`))
    .map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), "utf8")));
}

const runs = Object.fromEntries(labels.map((l) => [l, load(l)]));

// Headline per label: mean (min–max) over runs.
for (const [label, rs] of Object.entries(runs)) {
  if (rs.length === 0) {
    console.log(`${label}: no runs`);
    continue;
  }

  const stat = (f) => {
    const xs = rs.map(f);
    return `${pct(mean(xs))} (${pct(Math.min(...xs))}–${pct(Math.max(...xs))})`;
  };
  const groups = [...new Set(rs.flatMap((r) => Object.keys(r.summary.groups)))].sort();
  console.log(`\n${label}: ${rs.length} runs`);
  console.log(`  recall       ${stat((r) => r.summary.issues.hit / r.summary.issues.total)}`);
  for (const g of groups) {
    console.log(`  ${g.padEnd(18)} ${stat((r) => (r.summary.groups[g]?.hit ?? 0) / (r.summary.groups[g]?.total || 1))}`);
  }
  console.log(`  precision    ${stat((r) => (r.summary.findings - r.summary.unmatched) / (r.summary.findings || 1))}`);
  console.log(`  clean-case findings per run ${mean(rs.map((r) => r.summary.cleanFindings)).toFixed(1)}`);
  console.log(`  duplicates per run          ${mean(rs.map((r) => r.summary.duplicates)).toFixed(1)}`);
}

// Per issue: hit rate per label, listed where labels disagree.
const rate = (rs, id) => mean(rs.map((r) => (r.cases.flatMap((c) => c.issues).find((i) => i.id === id)?.found ? 1 : 0)));
const ids = [...new Set(Object.values(runs).flat().flatMap((r) => r.cases.flatMap((c) => c.issues.map((i) => i.id))))];
const rows = ids
  .map((id) => ({ id, rates: labels.map((l) => (runs[l].length ? rate(runs[l], id) : NaN)) }))
  .filter((r) => new Set(r.rates).size > 1 || r.rates.some((x) => x > 0 && x < 1))
  .sort((a, b) => a.rates[0] - a.rates.at(-1) - (b.rates[0] - b.rates.at(-1)));

console.log(`\nIssue hit rates (only issues that vary): ${labels.join(" | ")}`);
for (const r of rows) {
  console.log(`  ${r.id.padEnd(22)} ${r.rates.map((x) => pct(x).padStart(5)).join("  ")}`);
}
