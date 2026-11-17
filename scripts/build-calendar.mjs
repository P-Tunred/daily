#!/usr/bin/env node
/**
 * build-calendar.mjs — normalize the Google-Calendar Drive export
 * (`upcoming_events.json`) into the dashboard's bundled snapshot
 * (`electron/data/calendar.json`).
 *
 * With Google Drive for Desktop the server reads the synced export directly, so
 * this script is only needed for (a) seeding the bundled fallback and (b) the
 * on-demand "Kalender aktualisieren" refresh. It shares the exact normalizer the
 * server uses (electron/calendarSource.cjs) so there's no logic drift.
 *
 * Usage:
 *   node scripts/build-calendar.mjs <input> [output]
 *     <input>   raw export JSON, or a base64-encoded copy (auto-detected —
 *               base64 is what the Drive download tool returns).
 *     [output]  defaults to electron/data/calendar.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { normalizeDoc } = require(resolve(ROOT, "electron", "calendarSource.cjs"));

function parseInput(raw) {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  // base64-of-JSON (Drive download_file_content format)
  return JSON.parse(Buffer.from(text, "base64").toString("utf-8"));
}

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath) {
    console.error("usage: node scripts/build-calendar.mjs <input> [output]");
    process.exit(1);
  }
  const out = outPath
    ? resolve(process.cwd(), outPath)
    : resolve(ROOT, "electron", "data", "calendar.json");

  const raw = readFileSync(resolve(process.cwd(), inPath), "utf-8");
  const doc = normalizeDoc(parseInput(raw));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log(`[build-calendar] wrote ${doc.count} events → ${out}`);
}

main();
