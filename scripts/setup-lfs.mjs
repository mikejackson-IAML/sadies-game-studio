#!/usr/bin/env node
/**
 * One-time Git LFS setup for the world binaries.
 *
 *   npm run lfs:setup
 *
 * Run this BEFORE the first push if you can — converting later means rewriting
 * history, which this script will offer to do but which is disruptive once
 * anyone else has cloned.
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts });

try {
  const version = git(["lfs", "version"]).trim();
  console.log(`  ok    ${version}`);
} catch {
  console.error(
    [
      "",
      "  git-lfs is not installed.",
      "",
      "    macOS:          brew install git-lfs",
      "    Debian/Ubuntu:  sudo apt-get install git-lfs",
      "    Windows:        included with Git for Windows, or https://git-lfs.com",
      "",
      "  Then run this again.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

git(["lfs", "install", "--local"]);
console.log("  ok    LFS hooks installed for this repo");

const tracked = git(["lfs", "track"]);
console.log(tracked.trim().split("\n").map((l) => `        ${l}`).join("\n"));

// Anything already committed as a plain blob needs converting.
let alreadyCommitted = [];
try {
  alreadyCommitted = git(["ls-files", "worlds/", "docs/worlds/"])
    .split("\n")
    .filter((f) => /\.(spz|ply|glb)$/.test(f));
} catch {
  alreadyCommitted = [];
}

const notInLfs = alreadyCommitted.filter((file) => {
  try {
    return !git(["cat-file", "-p", `HEAD:${file}`]).startsWith("version https://git-lfs");
  } catch {
    return false;
  }
});

if (notInLfs.length) {
  console.log(`\n  ${notInLfs.length} world file(s) were committed before LFS was enabled:`);
  for (const f of notInLfs) console.log(`        ${f}`);
  console.log(
    [
      "",
      "  To convert them (REWRITES HISTORY — safe now, disruptive after others clone):",
      "",
      '    git lfs migrate import --include="worlds/**/*.spz,worlds/**/*.ply,worlds/**/*.glb,docs/worlds/**"',
      "",
      "  Then push with --force-with-lease. If the repo is already shared, leave them",
      "  as-is instead; only new worlds will use LFS.",
      "",
    ].join("\n"),
  );
} else {
  console.log("\n  All world files are in LFS (or there are none yet).\n");
}
