#!/usr/bin/env node
/**
 * Builds Sadie's character reference ("Soul ID") so her character can be drawn
 * consistently in every world's style.
 *
 *   npm run character:setup                    # uses photos in private/
 *   npm run character:setup -- --urls a.jpg,b.jpg
 *
 * Photos in private/ are gitignored and are used exactly once. Only the
 * returned reference ID is written to config/studio.json — never the images.
 *
 * If the API rejects inline photos and demands public URLs, this stops and says
 * so rather than publishing her pictures somewhere to manufacture a URL. That
 * is your decision to make, not this script's.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCharacter, getCharacter, higgsfieldAvailable } from "../mcp/lib/higgsfield.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = join(ROOT, "private");
const CONFIG = join(ROOT, "config", "studio.json");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
};

if (!higgsfieldAvailable()) {
  console.error(
    [
      "",
      "  HIGGSFIELD_API_KEY and HIGGSFIELD_SECRET must both be set.",
      "  Put them in .env (gitignored) or the environment, then run this again.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const urls = (arg("urls") || "").split(",").map((u) => u.trim()).filter(Boolean);
const files = urls.length
  ? []
  : (existsSync(PRIVATE) ? readdirSync(PRIVATE) : [])
      .filter((f) => [".jpg", ".jpeg", ".png", ".webp"].includes(extname(f).toLowerCase()))
      .slice(0, 5)
      .map((f) => join(PRIVATE, f));

if (!urls.length && !files.length) {
  console.error(
    [
      "",
      "  No reference photos found.",
      "",
      "  Put 1-5 clear photos of her face (different angles) in private/ and run again,",
      "  or pass hosted URLs:  npm run character:setup -- --urls https://.../a.jpg,https://.../b.jpg",
      "",
      "  private/ is gitignored. The photos are never committed or deployed.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const name = arg("name") || "studio-character";
console.log(`\n  Creating character reference "${name}" from ${urls.length || files.length} image(s)...`);

let reference;
try {
  reference = await createCharacter({ name, imageUrls: urls, imageFiles: files });
} catch (err) {
  console.error(`\n  Failed: ${err.adminDetail || err.message}\n`);
  process.exit(1);
}

const id = reference?.id || reference?.custom_reference_id;
if (!id) {
  console.error(`\n  The API did not return a reference id. Response: ${JSON.stringify(reference).slice(0, 300)}\n`);
  process.exit(1);
}

// The reference may take a moment to become usable.
let status = reference.status || "unknown";
for (let i = 0; i < 30 && !["ready", "completed", "active"].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    status = (await getCharacter(id))?.status || status;
  } catch {
    break;
  }
  process.stdout.write(`\r  status: ${status}          `);
}

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
const comments = config._comments;
delete config._comments;
config.characterReferenceId = id;
config.imageProvider = "higgsfield";
comments.characterReferenceId =
  "Higgsfield Soul ID for her character. Just an id — her photos are never stored in this repo.";
config._comments = comments;
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  [
    "",
    `\n  Character reference created: ${id}`,
    `  status: ${status}`,
    "",
    "  Saved to config/studio.json as characterReferenceId, and imageProvider is now",
    "  \"higgsfield\". Her character art will be drawn in each new world's style.",
    "",
    "  Her photos were NOT copied anywhere. Delete private/ whenever you like.",
    "",
  ].join("\n"),
);
