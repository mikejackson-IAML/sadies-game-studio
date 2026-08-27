#!/usr/bin/env node
/**
 * Spark imports a handful of three.js addons (three/addons/...). Those are not
 * part of three.module.js, so they must be vendored too or the games only work
 * with a CDN. Copies exactly the addons Spark reaches, following relative
 * imports transitively.
 *
 *   node scripts/vendor-addons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSM = join(ROOT, "node_modules", "three", "examples", "jsm");
const OUT = join(ROOT, "vendor", "three-addons");

const spark = readFileSync(join(ROOT, "vendor", "spark.module.min.js"), "utf8");
const seeds = [...spark.matchAll(/three\/addons\/([A-Za-z0-9_./-]+\.js)/g)].map((m) => m[1]);

const queue = [...new Set(seeds)];
const done = new Set();

while (queue.length) {
  const rel = normalize(queue.shift());
  if (done.has(rel)) continue;
  done.add(rel);

  const src = join(JSM, rel);
  if (!existsSync(src)) {
    console.warn(`  missing addon (skipped): ${rel}`);
    continue;
  }
  const code = readFileSync(src, "utf8");
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, code);

  // Follow this file's own imports so nothing 404s at runtime.
  for (const m of code.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith("three/addons/")) {
      queue.push(spec.replace("three/addons/", ""));
    } else if (spec.startsWith(".")) {
      queue.push(normalize(join(dirname(rel), spec)));
    }
    // Bare "three" resolves through the import map; nothing to copy.
  }
}

console.log(`Vendored ${done.size} three.js addon file(s) -> vendor/three-addons/`);
for (const f of [...done].sort()) console.log(`  ${f}`);
