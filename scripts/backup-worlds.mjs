#!/usr/bin/env node
/**
 * Second copy of every world, with integrity checking.
 *
 * Each Marble world costs a day of her life's one-a-day allowance, so a single
 * copy in one git remote is not enough. This mirrors worlds/ to a second
 * location and keeps a SHA-256 manifest so silent corruption is detectable.
 *
 *   npm run backup                  # mirror + verify
 *   npm run backup -- --verify      # check only, copy nothing
 *   npm run backup -- --to /path    # override the destination
 *
 * Destination resolution: --to, then STUDIO_BACKUP_PATH, then `backupPath` in
 * config/studio.json. Any path works — an external drive, a synced folder
 * (Dropbox/iCloud/Drive), or an rclone mount.
 */
import {
  existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORLDS = join(ROOT, "worlds");
const MANIFEST = join(WORLDS, "backup-manifest.json");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
};
const verifyOnly = process.argv.includes("--verify");

function destination() {
  const explicit = arg("to") || process.env.STUDIO_BACKUP_PATH;
  if (explicit) return explicit;
  try {
    return JSON.parse(readFileSync(join(ROOT, "config", "studio.json"), "utf8")).backupPath || null;
  } catch {
    return null;
  }
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    // Drafts are backed up too — an unbuilt World Card is still her work.
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full !== MANIFEST) files.push(full);
  }
  return files;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const files = walk(WORLDS);
if (!files.length) {
  console.log("\n  No worlds to back up yet.\n");
  process.exit(0);
}

// Always refresh the in-repo manifest: it is the integrity record even when no
// second location is configured yet.
const manifest = { version: 1, updatedAtUtc: new Date().toISOString(), files: {} };
for (const file of files) manifest.files[relative(WORLDS, file)] = { sha256: sha256(file), bytes: statSync(file).size };
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const totalMb = (Object.values(manifest.files).reduce((a, f) => a + f.bytes, 0) / 1024 / 1024).toFixed(1);
console.log(`\n  ${files.length} world file(s), ${totalMb} MB. Manifest written to worlds/backup-manifest.json`);

const dest = destination();
if (!dest) {
  console.log(
    [
      "",
      "  No backup destination configured — nothing was mirrored.",
      "  Set one with either:",
      '    - "backupPath" in config/studio.json',
      "    - the STUDIO_BACKUP_PATH environment variable",
      "    - npm run backup -- --to /Volumes/MyDrive/game-studio-backup",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

let copied = 0;
let verified = 0;
let repaired = 0;
const problems = [];

for (const file of files) {
  const rel = relative(WORLDS, file);
  const target = join(dest, "worlds", rel);
  try {
    if (existsSync(target)) {
      if (sha256(target) === manifest.files[rel].sha256) {
        verified++;
        continue;
      }
      if (verifyOnly) {
        problems.push(`${rel}: backup copy does not match (corrupt or stale)`);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
      repaired++;
    } else {
      if (verifyOnly) {
        problems.push(`${rel}: missing from the backup`);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
      copied++;
    }
  } catch (err) {
    problems.push(`${rel}: ${err.message}`);
  }
}

if (!verifyOnly) {
  try {
    mkdirSync(dest, { recursive: true });
    copyFileSync(MANIFEST, join(dest, "backup-manifest.json"));
  } catch (err) {
    problems.push(`manifest: ${err.message}`);
  }
}

console.log(`  destination: ${dest}`);
console.log(`  new: ${copied}   repaired: ${repaired}   already good: ${verified}`);
if (problems.length) {
  console.error(`\n  ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    - ${p}`);
  console.error("");
  process.exit(1);
}
console.log("  backup OK\n");
