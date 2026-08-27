/**
 * End-to-end make_world flow against a mocked World Labs API. No real network,
 * no real key, no credits — but every layer the real call goes through.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-gen-"));
for (const d of ["logs", "config", "worlds"]) mkdirSync(join(root, d), { recursive: true });
process.env.STUDIO_ROOT = root;
process.env.WORLDLABS_API_KEY = "test-key-not-real";
writeFileSync(
  join(root, "config", "studio.json"),
  JSON.stringify({ dailyWorldLimit: 1, timezone: "America/Chicago", marbleModel: "marble-1.1-plus", splatQuality: "500k" }),
);

const { makeWorld, listMyWorlds, worldsLeftToday } = await import("../lib/tools.js");
const { paths } = await import("../lib/config.js");

const SPLAT_URL = "https://cdn.example.test/world.spz";
const WORLD = {
  world_id: "wl-world-123",
  assets: {
    splats: { spz_urls: { "500k": SPLAT_URL, "100k": "https://cdn.example.test/small.spz" } },
    mesh: { collider_mesh_url: "https://cdn.example.test/collider.glb" },
    thumbnail_url: "https://cdn.example.test/thumb.jpg",
    caption: "A candy forest at sunset",
  },
};

const calls = [];
let failNext = null;

function mockFetch(url, init = {}) {
  const target = String(url);
  calls.push({ url: target, method: init.method || "GET", body: init.body });

  if (failNext) {
    const { status } = failNext;
    failNext = null;
    return Promise.resolve({
      ok: false, status, statusText: "Error",
      json: async () => ({ error: { message: "mock failure" } }),
    });
  }
  const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

  if (target.endsWith("/worlds:generate")) return json({ operation_id: "op-1" });
  if (target.includes("/worlds:expand")) {
    return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) });
  }
  if (target.includes("/operations/")) return json({ done: true, response: WORLD });
  if (target.startsWith("https://cdn.example.test/")) {
    return Promise.resolve({
      ok: true, status: 200, body: {},
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
    });
  }
  return json({});
}
globalThis.fetch = mockFetch;

const textOf = (result) => result.content[0].text;

test("the first world of the day is generated, downloaded and registered", async () => {
  const result = await makeWorld({
    description: "A candy forest at sunset with a chocolate river and a secret door in the biggest tree",
    name: "Candy Forest",
  });
  assert.match(textOf(result), /SUCCESS/);

  const registry = JSON.parse(readFileSync(paths.registry, "utf8"));
  assert.equal(registry.worlds.length, 1);
  const world = registry.worlds[0];
  assert.equal(world.name, "Candy Forest");
  assert.equal(world.worldId, "wl-world-123");
  assert.equal(world.files.splat, "world.spz");
  assert.ok(existsSync(join(root, "worlds", world.id, "world.spz")));
  assert.ok(existsSync(join(root, "worlds", world.id, "thumb.jpg")));

  const usage = JSON.parse(readFileSync(paths.usageJson, "utf8"));
  assert.equal(usage.generations.length, 1);
  assert.equal(usage.generations[0].status, "succeeded");
  assert.equal(usage.generations[0].creditsEstimate, 1500);

  // The prompt sent must be the assembled description, not a bare one-liner.
  const generate = calls.find((c) => c.url.endsWith("/worlds:generate"));
  assert.match(JSON.parse(generate.body).world_prompt.text_prompt, /chocolate river/);
});

test("the human-readable log records the generation for Dad", () => {
  const md = readFileSync(paths.usageMd, "utf8");
  assert.match(md, /Candy Forest|candy forest/i);
  assert.match(md, /succeeded/);
});

test("a second world the same day is refused kindly and saved for tomorrow", async () => {
  const before = calls.length;
  const result = await makeWorld({ description: "A dinosaur island with a volcano", name: "Dino Island" });
  const text = textOf(result);

  assert.match(text, /NO GENERATION HAPPENED/);
  assert.equal(calls.length, before, "no API call may be made once the limit is reached");

  const tomorrow = readFileSync(paths.tomorrow, "utf8");
  assert.match(tomorrow, /Dino Island/);
  assert.match(tomorrow, /dinosaur island with a volcano/);
});

test("the refusal never leaks technical detail to her", async () => {
  const text = textOf(await makeWorld({ description: "Another world", name: "Nope" }));
  assert.doesNotMatch(text, /http|api|401|402|token|key/i);
});

test("worlds_left_today reports the limit is used up", () => {
  assert.match(textOf(worldsLeftToday()), /used her world for today/i);
});

test("list_my_worlds shows her world by name and date", () => {
  const text = textOf(listMyWorlds());
  assert.match(text, /Candy Forest/);
  assert.match(text, /worlds\//);
});

test("an API failure before the call does not cost her the day", async () => {
  // Fresh studio so there is an allowance to spend.
  writeFileSync(paths.usageJson, JSON.stringify({ version: 1, generations: [] }));
  failNext = { status: 402 };

  const text = textOf(await makeWorld({ description: "A rainbow castle in the clouds", name: "Castle" }));
  assert.match(text, /WORLD NOT MADE/);
  assert.match(text, /sparkles/i, "she should get the friendly out-of-credits wording");
  assert.match(text, /NOT used up/);
  assert.doesNotMatch(text, /402|credits on|platform\./i);

  const usage = JSON.parse(readFileSync(paths.usageJson, "utf8"));
  assert.equal(usage.generations.length, 0, "a pre-flight failure must leave no record");
});

test("add_to an unknown world spends nothing", async () => {
  const before = calls.length;
  const text = textOf(await makeWorld({ description: "add a waterfall", add_to_world: "no-such-world" }));
  assert.match(text, /NO GENERATION HAPPENED/);
  assert.equal(calls.length, before);
});

test("add_to falls back to a remix that preserves the original world", async () => {
  writeFileSync(paths.usageJson, JSON.stringify({ version: 1, generations: [] }));
  const registry = JSON.parse(readFileSync(paths.registry, "utf8"));
  const original = registry.worlds[0];

  const result = await makeWorld({
    description: "a giant waterfall behind the trees",
    name: "Candy Forest Bigger",
    add_to_world: original.id,
  });
  assert.match(textOf(result), /SUCCESS/);

  // The remix prompt must carry the original world's prompt forward.
  const generate = calls.filter((c) => c.url.endsWith("/worlds:generate")).pop();
  const sent = JSON.parse(generate.body).world_prompt.text_prompt;
  assert.match(sent, /chocolate river/, "the original description must be preserved");
  assert.match(sent, /giant waterfall/, "her addition must be included");

  // The original world's files are untouched and still registered.
  const after = JSON.parse(readFileSync(paths.registry, "utf8"));
  assert.equal(after.worlds.length, 2);
  assert.ok(after.worlds.find((w) => w.id === original.id), "the original must still exist");
  assert.ok(existsSync(join(root, "worlds", original.id, "world.spz")));
});
