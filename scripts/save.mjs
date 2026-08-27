#!/usr/bin/env node
/**
 * "Save my game" — commits and pushes everything, with a friendly message.
 * She will never run git herself, so this must always be safe to run and must
 * never destroy anything: it only ever adds.
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const CHEERS = [
  "Saved your work! ✨", "All safe! 🎮", "Your games are locked in! 🔒",
  "Saved forever! 🌈", "Got it all! 🚀",
];

try {
  git(["add", "-A"]);
  const staged = git(["diff", "--cached", "--name-only"]).trim();
  if (!staged) {
    console.log("Everything was already saved! Nothing new to keep. ✨");
    process.exit(0);
  }
  const count = staged.split("\n").length;
  git(["commit", "-m", `Save my game (${count} file${count === 1 ? "" : "s"})`]);
  console.log(CHEERS[Math.floor(Math.random() * CHEERS.length)]);

  try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    git(["push", "origin", branch]);
    console.log("Backed up online too — nothing can get lost now. 💾");
  } catch {
    console.log("Saved on this computer. (Couldn't reach the internet to back it up — it'll go next time.)");
  }
} catch (err) {
  console.error(`Save failed: ${String(err.message).split("\n")[0]}`);
  process.exit(1);
}
