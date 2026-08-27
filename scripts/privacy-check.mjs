#!/usr/bin/env node
/**
 * Hard privacy gate on everything that gets deployed.
 *
 * The rule is first name only, ever — no last name, school, city, street, or
 * photo metadata anywhere in docs/. This runs automatically inside `npm run
 * ship` and fails the publish rather than warning, because a warning in a log
 * nobody reads is not a safeguard.
 *
 *   npm run privacy          # check docs/
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hasJpegMetadata } from "./lib/jpeg.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const TEXT_EXT = new Set([".html", ".json", ".js", ".mjs", ".css", ".md", ".txt", ".svg", ".xml"]);

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "vendor") continue; // third-party library code, not her content
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function loadForbidden() {
  const local = join(ROOT, "config", "privacy.local.json");
  if (!existsSync(local)) return { words: [], configured: false };
  try {
    const data = JSON.parse(readFileSync(local, "utf8"));
    const words = (data.forbidden || [])
      .map((w) => String(w).trim())
      .filter((w) => w.length >= 3 && !w.startsWith("Put"));
    return { words, configured: true };
  } catch {
    return { words: [], configured: false };
  }
}

export function runPrivacyCheck({ quiet = false } = {}) {
  const { words, configured } = loadForbidden();
  const violations = [];
  const files = walk(DOCS);

  for (const file of files) {
    const rel = relative(ROOT, file);
    const ext = extname(file).toLowerCase();

    if (TEXT_EXT.has(ext)) {
      const text = readFileSync(file, "utf8");
      for (const word of words) {
        const pattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (pattern.test(text)) violations.push(`${rel}: contains a forbidden word ("${word}")`);
      }
    } else if (ext === ".jpg" || ext === ".jpeg") {
      if (hasJpegMetadata(readFileSync(file))) {
        violations.push(`${rel}: JPEG still has EXIF/metadata (may contain GPS or device details)`);
      }
    }
  }

  if (!quiet) {
    if (!configured) {
      console.log(
        "  privacy: no config/privacy.local.json — text scanning is OFF.\n" +
          "           Copy config/privacy.example.json to config/privacy.local.json and fill it in.\n" +
          "           (Image metadata is still checked and stripped.)",
      );
    } else {
      console.log(`  privacy: scanned ${files.length} deployed file(s) against ${words.length} forbidden word(s)`);
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = runPrivacyCheck();
  if (violations.length) {
    console.error("\n  PRIVACY CHECK FAILED — nothing was published:\n");
    for (const v of violations) console.error(`    - ${v}`);
    console.error("");
    process.exit(1);
  }
  console.log("  privacy: OK\n");
}
