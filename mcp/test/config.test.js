import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-config-"));
mkdirSync(join(root, "config"), { recursive: true });
process.env.STUDIO_ROOT = root;

const { loadConfig, redact, paths } = await import("../lib/config.js");
const write = (cfg) => writeFileSync(paths.config, JSON.stringify(cfg));

test("a missing config falls back to safe defaults", () => {
  const cfg = loadConfig();
  assert.equal(cfg.dailyWorldLimit, 1);
  assert.equal(cfg.requireShipApproval, false);
  assert.equal(cfg.timezone, "America/Chicago");
});

test("a silly daily limit is clamped, not obeyed", () => {
  write({ dailyWorldLimit: 9999 });
  assert.equal(loadConfig().dailyWorldLimit, 20);
  write({ dailyWorldLimit: -5 });
  assert.equal(loadConfig().dailyWorldLimit, 0);
  write({ dailyWorldLimit: "banana" });
  assert.equal(loadConfig().dailyWorldLimit, 1);
});

test("ship approval must be exactly true to switch on", () => {
  write({ requireShipApproval: "yes" });
  assert.equal(loadConfig().requireShipApproval, false);
  write({ requireShipApproval: true });
  assert.equal(loadConfig().requireShipApproval, true);
});

test("an unknown splat quality falls back to the phone-friendly one", () => {
  write({ splatQuality: "8k_ultra" });
  assert.equal(loadConfig().splatQuality, "500k");
});

test("redact strips anything that looks like a key", () => {
  const text = "failed with wl-abcdef1234567890 in the header";
  assert.ok(!redact(text).includes("wl-abcdef1234567890"));
  assert.match(redact(text), /\[key hidden\]/);
});

test("redact removes the live key even when it has an odd shape", () => {
  process.env.WORLDLABS_API_KEY = "totally-custom-secret-value";
  assert.ok(!redact("boom: totally-custom-secret-value").includes("totally-custom-secret-value"));
  delete process.env.WORLDLABS_API_KEY;
});
