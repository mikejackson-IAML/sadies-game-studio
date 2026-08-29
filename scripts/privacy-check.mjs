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

/**
 * The forbidden-word list, from two places that are merged:
 *
 *  - config/privacy.local.json — gitignored, for a local checkout.
 *  - STUDIO_FORBIDDEN_WORDS    — comma-separated, for Claude Code sessions.
 *
 * The environment variable matters more than it looks: the file is gitignored
 * (correctly — these are a child's real details and the repo is public), so it
 * does not exist in the container where she actually runs /ship. Without the
 * env var the scan would be silently off in the one place it needs to run.
 */
function loadForbidden() {
  const clean = (list) =>
    list
      .map((w) => String(w).trim())
      .filter((w) => w.length >= 3 && !w.startsWith("Put"));

  const words = new Set();
  let configured = false;

  const fromEnv = process.env.STUDIO_FORBIDDEN_WORDS;
  if (fromEnv && fromEnv.trim()) {
    for (const w of clean(fromEnv.split(","))) words.add(w);
    configured = true;
  }

  const local = join(ROOT, "config", "privacy.local.json");
  if (existsSync(local)) {
    try {
      const data = JSON.parse(readFileSync(local, "utf8"));
      for (const w of clean(data.forbidden || [])) words.add(w);
      configured = true;
    } catch {
      // A corrupt file must not silently disable whatever the env provided.
    }
  }
  return { words: [...words], configured };
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
        "  privacy: NO WORD LIST — text scanning is OFF.\n" +
          "           Locally:  npm run privacy:setup\n" +
          "           In a Claude Code session: set STUDIO_FORBIDDEN_WORDS on the environment.\n" +
          "           (Image metadata is still checked and stripped either way.)",
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
