#!/usr/bin/env node
/**
 * Interactive setup for config/privacy.local.json.
 *
 *   npm run privacy:setup
 *
 * Deliberately interactive and local: the words on this list are her real last
 * name, school and town, and they should be typed into your own terminal — not
 * pasted into a chat window, a commit message, or an issue. The file it writes
 * is gitignored and never leaves your machine.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "config", "privacy.local.json");

const PROMPTS = [
  ["Her last name", "The single most important one."],
  ["Her school's name", "Include the short form too if people use one."],
  ["Your town or city", ""],
  ["Your street name", ""],
  ["Anything else that must never appear", "Sports club, church, a nickname only family use. Blank to skip."],
];

// Interactive on a terminal; line-by-line when input is piped (which is how
// the tests drive it). readline alone does neither reliably: on a closed stdin
// rl.question hangs rather than rejecting.
const piped = !stdin.isTTY;
let pipedLines = [];
let rl = null;

if (piped) {
  let buffer = "";
  for await (const chunk of stdin) buffer += chunk;
  pipedLines = buffer.split("\n");
} else {
  rl = createInterface({ input: stdin, output: stdout });
}

async function ask(question) {
  if (piped) {
    const next = pipedLines.shift();
    return next === undefined ? "" : next.trim();
  }
  try {
    return (await rl.question(question)).trim();
  } catch {
    return "";
  }
}

console.log(`
  Privacy word list
  -----------------
  Anything you enter here will BLOCK a publish if it ever shows up in a game,
  the arcade, a page title, or a file name. Matching is case-insensitive and
  whole-word.

  This writes config/privacy.local.json, which is gitignored. Press Enter to
  skip any line. Enter one item per line; you can add more later by editing
  the file or re-running this.
`);

const words = [];
if (existsSync(TARGET)) {
  try {
    const existing = JSON.parse(readFileSync(TARGET, "utf8")).forbidden || [];
    if (existing.length) {
      console.log(`  Existing list has ${existing.length} entr${existing.length === 1 ? "y" : "ies"}; they will be kept.\n`);
      words.push(...existing);
    }
  } catch {
    console.log("  (existing file was unreadable and will be replaced)\n");
  }
}

for (const [label, hint] of PROMPTS) {
  const answer = await ask(`  ${label}${hint ? ` — ${hint}` : ""}\n  > `);
  if (answer) words.push(...answer.split(",").map((w) => w.trim()).filter(Boolean));
}

// More entries, freeform, until a blank line.
while (true) {
  const extra = await ask("\n  Another word (blank to finish)\n  > ");
  if (!extra) break;
  words.push(extra);
}
rl?.close();

const unique = [...new Set(words.filter((w) => w.length >= 3))];
const tooShort = words.filter((w) => w.length < 3);

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(
  TARGET,
  `${JSON.stringify({
    _comment: "GITIGNORED. Real personal details, used only to block publishing. Never commit this file.",
    forbidden: unique,
  }, null, 2)}\n`,
);

console.log(`\n  Wrote ${unique.length} word(s) to config/privacy.local.json`);
if (tooShort.length) {
  console.log(`  Skipped ${tooShort.length} entr${tooShort.length === 1 ? "y" : "ies"} under 3 characters (too many false matches).`);
}
console.log("  Check it works:  npm run privacy\n");

if (unique.length) {
  console.log("  ─────────────────────────────────────────────────────────────────");
  console.log("  This file is gitignored, so it does NOT reach Sadie's Claude Code");
  console.log("  environment — where /ship actually runs. Add this there too, as an");
  console.log("  environment variable, or the scan is off in the place that matters:");
  console.log("");
  console.log("    Name:   STUDIO_FORBIDDEN_WORDS");
  console.log(`    Value:  ${unique.join(",")}`);
  console.log("  ─────────────────────────────────────────────────────────────────\n");
}
