import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { paths } from "./config.js";

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot corrupt the ledger. */
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

// ------------------------------------------------------------------ usage log

export function readUsage() {
  const data = readJson(paths.usageJson, { version: 1, generations: [] });
  if (!Array.isArray(data.generations)) data.generations = [];
  return data;
}

/**
 * Records an in-flight generation. Written BEFORE the API call so that a crash
 * between "credits spent" and "world downloaded" still counts against the day.
 */
export function openGeneration({ day, description, prompt, model, kind, parentWorldId }) {
  const usage = readUsage();
  const record = {
    recordId: randomUUID(),
    day,
    startedAtUtc: new Date().toISOString(),
    finishedAtUtc: null,
    status: "pending",
    kind,
    parentWorldId: parentWorldId ?? null,
    description,
    prompt,
    model,
    worldId: null,
    creditsEstimate: null,
    note: "",
  };
  usage.generations.push(record);
  writeJson(paths.usageJson, usage);
  return record.recordId;
}

export function closeGeneration(recordId, patch) {
  const usage = readUsage();
  const rec = usage.generations.find((g) => g.recordId === recordId);
  if (!rec) return null;
  Object.assign(rec, patch, { finishedAtUtc: new Date().toISOString() });
  writeJson(paths.usageJson, usage);
  if (rec.status === "succeeded" || rec.status === "failed") appendUsageMarkdown(rec);
  return rec;
}

/**
 * Drops a generation that never reached the API (missing key, network down).
 * She should not lose her one world a day to a problem that is not hers.
 */
export function cancelGeneration(recordId) {
  const usage = readUsage();
  const before = usage.generations.length;
  usage.generations = usage.generations.filter((g) => g.recordId !== recordId);
  if (usage.generations.length !== before) writeJson(paths.usageJson, usage);
}

/** The adult-readable log. Append-only; Dad reads this, she never sees it. */
function appendUsageMarkdown(rec) {
  const HEADER = [
    "# World generation log",
    "",
    "Every Marble API call this studio has made. Append-only. Written automatically",
    "by the MCP server — do not hand-edit; `logs/usage.json` is the source of truth",
    "for the daily limit.",
    "",
    "| Date (local) | Status | Kind | Description | World ID | Model | Est. credits |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "",
  ].join("\n");

  mkdirSync(dirname(paths.usageMd), { recursive: true });
  if (!existsSync(paths.usageMd)) writeFileSync(paths.usageMd, HEADER);

  const cell = (v) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
  const row = `| ${cell(rec.day)} | ${cell(rec.status)} | ${cell(rec.kind)} | ${cell(rec.description)} | ${cell(rec.worldId)} | ${cell(rec.model)} | ${cell(rec.creditsEstimate)} |\n`;
  writeFileSync(paths.usageMd, row, { flag: "a" });
}

// ------------------------------------------------------------------ registry

export function readRegistry() {
  const data = readJson(paths.registry, { version: 1, worlds: [] });
  if (!Array.isArray(data.worlds)) data.worlds = [];
  return data;
}

export function registerWorld(world) {
  const reg = readRegistry();
  reg.worlds = reg.worlds.filter((w) => w.id !== world.id);
  reg.worlds.push(world);
  reg.worlds.sort((a, b) => String(a.createdAtUtc).localeCompare(String(b.createdAtUtc)));
  writeJson(paths.registry, reg);
  return world;
}

/** Turns "a candy forest with a secret door" into a safe, readable folder name. */
export function slugify(text, fallback = "world") {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export function uniqueWorldId(name) {
  const base = slugify(name);
  const taken = new Set(readRegistry().worlds.map((w) => w.id));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}
