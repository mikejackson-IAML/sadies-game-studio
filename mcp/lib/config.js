import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// STUDIO_ROOT lets the tests point the whole studio at a scratch directory so
// they never touch her real ledger, worlds, or logs.
export const ROOT =
  process.env.STUDIO_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const paths = {
  root: ROOT,
  config: join(ROOT, "config", "studio.json"),
  worldsDir: join(ROOT, "worlds"),
  registry: join(ROOT, "worlds", "worlds.json"),
  usageJson: join(ROOT, "logs", "usage.json"),
  usageMd: join(ROOT, "logs", "usage.md"),
  tomorrow: join(ROOT, "tomorrows-world.md"),
  aboutMe: join(ROOT, "about-me.md"),
  docs: join(ROOT, "docs"),
};

const DEFAULTS = {
  studioName: "",
  dailyWorldLimit: 1,
  timezone: "America/Chicago",
  marbleModel: "marble-1.1-plus",
  splatQuality: "500k",
  requireShipApproval: false,
};

export function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(paths.config, "utf8"));
  } catch {
    // A missing or corrupt config must never hand out extra generations.
  }
  const cfg = { ...DEFAULTS, ...raw };
  delete cfg._comments;

  // Clamp to sane values: a typo in the config file should not become an
  // unlimited-spend bug on Dad's credit card.
  const n = Number(cfg.dailyWorldLimit);
  cfg.dailyWorldLimit = Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 1;
  if (!["100k", "500k", "full_res"].includes(cfg.splatQuality)) cfg.splatQuality = "500k";
  cfg.requireShipApproval = cfg.requireShipApproval === true;
  return cfg;
}

/**
 * The World Labs key, from the environment only. Falls back to reading a
 * gitignored .env so Dad can run things locally, but never writes it anywhere.
 */
export function getApiKey() {
  const fromEnv = process.env.WORLDLABS_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const envFile = join(ROOT, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*WORLDLABS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) {
        const v = m[1].replace(/^["']|["']$/g, "").trim();
        if (v && !v.startsWith("wl-xxxx")) return v;
      }
    }
  }
  return null;
}

/** Strip the API key out of anything before it can reach a log or a response. */
export function redact(text) {
  const s = String(text ?? "");
  const key = getApiKey();
  let out = s;
  if (key && key.length >= 8) out = out.split(key).join("[key hidden]");
  return out.replace(/\b(wl-|sk-)[A-Za-z0-9_-]{8,}/g, "[key hidden]");
}
