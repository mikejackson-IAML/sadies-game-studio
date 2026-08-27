#!/usr/bin/env node
/**
 * One-time smoke test against the REAL World Labs API. Run this once after
 * setting the key, to prove the whole path works before she ever uses it.
 *
 *   WORLDLABS_API_KEY=... npm run smoke          # checks auth only, free
 *   WORLDLABS_API_KEY=... npm run smoke -- --generate   # SPENDS ONE GENERATION
 *
 * Without --generate this makes no billable call: it only verifies the key is
 * accepted and reports what the expansion probe found.
 */
import { loadConfig, getApiKey } from "../mcp/lib/config.js";
import { expansionSupported } from "../mcp/lib/worldlabs.js";
import { checkAllowance } from "../mcp/lib/limit.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPS = join(ROOT, "logs", "api-capabilities.json");
const readCaps = () => {
  try {
    return JSON.parse(readFileSync(CAPS, "utf8"));
  } catch {
    return {};
  }
};

const generate = process.argv.includes("--generate");
const config = loadConfig();

console.log("\n  Her Game Studio — smoke test\n");

const key = getApiKey();
if (!key) {
  console.error("  FAIL  No API key found.");
  console.error("        Set WORLDLABS_API_KEY in the environment, or put it in .env");
  console.error("        (copy .env.example to .env). Get one at https://platform.worldlabs.ai/\n");
  process.exit(1);
}
console.log(`  ok    API key found (${key.length} characters, value not shown)`);
console.log(`  ok    Model: ${config.marbleModel}   Daily limit: ${config.dailyWorldLimit}   Timezone: ${config.timezone}`);

const allowance = checkAllowance(config);
console.log(`  ok    Allowance today (${allowance.day}): ${allowance.remaining} of ${allowance.limit} left`);

// worlds:list is the cheapest authenticated call — proves the key without spending.
const response = await fetch("https://api.worldlabs.ai/marble/v1/worlds:list", {
  method: "POST",
  headers: { "WLT-Api-Key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ page_size: 1 }),
  signal: AbortSignal.timeout(30_000),
}).catch((err) => ({ ok: false, status: 0, statusText: err.message }));

if (!response.ok) {
  console.error(`\n  FAIL  The API rejected the key (HTTP ${response.status} ${response.statusText || ""}).`);
  if (response.status === 401 || response.status === 403) {
    console.error("        Either the key is wrong/revoked, OR api.worldlabs.ai is blocked by an");
    console.error("        outbound network policy — those look identical from here.");
    console.error("        Run `npm run preflight` to tell them apart before touching the key.");
  } else if (response.status === 402) {
    console.error("        The key works but has no credits. NOTE: API Platform credits are");
    console.error("        SEPARATE from marble.worldlabs.ai web-app credits.");
  }
  console.error("");
  process.exit(1);
}
console.log("  ok    API accepted the key and answered");

const canExpand = await expansionSupported();
console.log(
  canExpand
    ? "  ok    A world-expansion endpoint EXISTS — 'add to my world' will use it"
    : "  ok    No expansion endpoint (expected) — 'add to my world' uses the remix path",
);

const caps = readCaps();
if (caps.workingModel) {
  console.log(`  ok    Known-good model from a previous run: ${caps.workingModel}`);
}

if (!generate) {
  console.log("\n  All checks passed. No credits were spent.");
  console.log("  To test a real world generation (SPENDS ONE GENERATION AND CREDITS):");
  console.log("    npm run smoke -- --generate\n");
  process.exit(0);
}

console.log("\n  Generating a real world — this spends credits and today's allowance...\n");
const { makeWorld } = await import("../mcp/lib/tools.js");
const result = await makeWorld({
  description:
    "A small sunny meadow ringed by tall birch trees, soft golden late-afternoon light, " +
    "wildflowers in the grass, a narrow dirt path winding through the middle, gentle mist in the distance",
  name: "Smoke Test Meadow",
});
const text = result.content[0].text;
console.log(text.split("\n").slice(0, 4).join("\n"));
const after = readCaps();
if (text.startsWith("SUCCESS")) {
  console.log("\n  Generation works end to end.");
  console.log("");
  console.log("  What the API actually accepted (this is the useful part — the model id and");
  console.log("  payload shape were inferred from client code, not official docs):");
  console.log(`    model:              ${after.workingModel ?? "(unrecorded)"}`);
  if (after.multiImageTextPrompt !== undefined) {
    console.log(`    multi-image text:   ${after.multiImageTextPrompt ? "accepted" : "REJECTED — dropped automatically"}`);
  }
  if (after.rejectedModels?.length) {
    console.log(`    models refused:     ${after.rejectedModels.join(", ")}`);
    console.log("");
    console.log(`  Consider setting "marbleModel": "${after.workingModel}" in config/studio.json`);
    console.log("  so future runs skip the refused ones entirely.");
  }
  console.log("");
  console.log("  Cached in logs/api-capabilities.json. Delete it to re-probe.");
  console.log("");
} else {
  console.log("\n  Generation did not succeed — see above.");
  if (existsSync(join(ROOT, "logs", "errors.log"))) {
    console.log("  The exact request the API refused is in logs/errors.log.");
  }
  console.log("");
}
process.exit(text.startsWith("SUCCESS") ? 0 : 1);
