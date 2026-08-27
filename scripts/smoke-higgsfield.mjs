#!/usr/bin/env node
/**
 * First real exercise of the Higgsfield path. The hosts were blocked in the
 * environment this was built in, so nothing here has ever run against the live
 * service — expect to fix something the first time.
 *
 *   npm run smoke:higgsfield              # auth + styles only, no generation
 *   npm run smoke:higgsfield -- --draw    # generates ONE image (costs credits)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  higgsfieldAvailable, listSoulStyles, listCharacters,
  generateSoulImage, waitForSoulImage,
} from "../mcp/lib/higgsfield.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
console.log("\n  Higgsfield smoke test\n");

if (!higgsfieldAvailable()) {
  console.error("  FAIL  HIGGSFIELD_API_KEY and HIGGSFIELD_SECRET must both be set.\n");
  process.exit(1);
}
console.log("  ok    both credentials present (values not shown)");

try {
  const styles = await listSoulStyles();
  const count = Array.isArray(styles) ? styles.length : (styles?.items?.length ?? 0);
  console.log(`  ok    API reachable — ${count} Soul style preset(s)`);
} catch (err) {
  console.error(`\n  FAIL  ${err.adminDetail || err.message}`);
  console.error("        If this is a network error, the host is still blocked by egress policy.\n");
  process.exit(1);
}

const config = JSON.parse(readFileSync(join(ROOT, "config", "studio.json"), "utf8"));
if (config.characterReferenceId) {
  try {
    const list = await listCharacters();
    const items = list?.items || list || [];
    const found = items.find?.((c) => (c.id || c.custom_reference_id) === config.characterReferenceId);
    console.log(found ? "  ok    character reference found and usable" : "  warn  configured character reference was not in the list");
  } catch (err) {
    console.log(`  warn  could not list characters: ${err.code || "error"}`);
  }
} else {
  console.log("  --    no characterReferenceId configured yet (run npm run character:setup)");
}

if (!process.argv.includes("--draw")) {
  console.log("\n  Auth checks passed. No credits spent.");
  console.log("  To generate one real image:  npm run smoke:higgsfield -- --draw\n");
  process.exit(0);
}

console.log("\n  Generating one image (this costs credits)...");
try {
  const jobSetId = await generateSoulImage({
    prompt:
      "Full-body children's storybook illustration of a young girl character standing happily " +
      "in a bright candy forest. Flat cartoon style, soft rounded shapes, plain background. " +
      "NOT photorealistic. No text.",
    characterReferenceId: config.characterReferenceId || null,
  });
  console.log(`  job set: ${jobSetId}`);
  const url = await waitForSoulImage(jobSetId, { onProgress: (s) => process.stdout.write(`\r  status: ${s}      `) });
  const response = await fetch(url);
  const out = join(ROOT, "private", "smoke-character.jpg");
  writeFileSync(out, Buffer.from(await response.arrayBuffer()));
  console.log(`\n\n  Wrote ${out} (gitignored). Open it — that is what her character art will look like.\n`);
} catch (err) {
  console.error(`\n\n  FAIL  ${err.adminDetail || err.message}\n`);
  process.exit(1);
}
