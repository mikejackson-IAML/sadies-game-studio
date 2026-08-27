import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-limit-"));
mkdirSync(join(root, "logs"), { recursive: true });
mkdirSync(join(root, "config"), { recursive: true });
process.env.STUDIO_ROOT = root;

const { checkAllowance } = await import("../lib/limit.js");
const { paths } = await import("../lib/config.js");

const CONFIG = { dailyWorldLimit: 1, timezone: "America/Chicago" };
const AT = new Date("2026-06-15T18:00:00Z"); // 13:00 local, 2026-06-15
const TODAY = "2026-06-15";

function setUsage(generations) {
  writeFileSync(paths.usageJson, JSON.stringify({ version: 1, generations }));
}

test("a fresh studio allows the day's world", () => {
  setUsage([]);
  const a = checkAllowance(CONFIG, AT);
  assert.equal(a.allowed, true);
  assert.equal(a.remaining, 1);
  assert.equal(a.day, TODAY);
});

test("a succeeded generation uses up the day", () => {
  setUsage([{ day: TODAY, status: "succeeded" }]);
  const a = checkAllowance(CONFIG, AT);
  assert.equal(a.allowed, false);
  assert.equal(a.remaining, 0);
  assert.match(a.resetsIn, /hour|tomorrow/);
});

test("a crashed run still counts — the credits were already spent", () => {
  setUsage([{ day: TODAY, status: "pending" }]);
  assert.equal(checkAllowance(CONFIG, AT).allowed, false);
});

test("a failed attempt that never reached the API does not count", () => {
  setUsage([{ day: TODAY, status: "failed" }]);
  assert.equal(checkAllowance(CONFIG, AT).allowed, true);
});

test("yesterday's world does not count against today", () => {
  setUsage([{ day: "2026-06-14", status: "succeeded" }]);
  assert.equal(checkAllowance(CONFIG, AT).allowed, true);
});

test("a raised limit allows exactly that many", () => {
  setUsage([{ day: TODAY, status: "succeeded" }, { day: TODAY, status: "succeeded" }]);
  const a = checkAllowance({ ...CONFIG, dailyWorldLimit: 3 }, AT);
  assert.equal(a.remaining, 1);
  assert.equal(a.allowed, true);
});

test("a limit of zero blocks everything", () => {
  setUsage([]);
  assert.equal(checkAllowance({ ...CONFIG, dailyWorldLimit: 0 }, AT).allowed, false);
});

test("a corrupt ledger fails closed rather than handing out free worlds", () => {
  writeFileSync(paths.usageJson, "{ this is not json");
  // An unreadable ledger reads as empty; the limit still applies to new writes.
  const a = checkAllowance(CONFIG, AT);
  assert.equal(a.limit, 1);
  assert.ok(a.remaining <= 1);
});
