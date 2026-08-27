/**
 * Self-correcting behaviour for the parts of the Marble API that were inferred
 * from client code rather than official docs.
 *
 * A wrong model id or an unexpected payload shape should cost one extra HTTP
 * round trip, not a failed first run — and must never be retried when the
 * problem is auth, credits or rate limiting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-fallback-"));
for (const d of ["logs", "config", "worlds"]) mkdirSync(join(root, d), { recursive: true });
process.env.STUDIO_ROOT = root;
process.env.WORLDLABS_API_KEY = "test-key";

const { startGeneration, startMultiImageGeneration } = await import("../lib/worldlabs.js");

const CAPS = join(root, "logs", "api-capabilities.json");
const ERRORS = join(root, "logs", "errors.log");
const readCaps = () => (existsSync(CAPS) ? JSON.parse(readFileSync(CAPS, "utf8")) : {});

let attempts = [];
/** Models the fake API will accept; everything else is a 400. */
let acceptModels = new Set(["marble-1.1"]);
let acceptTextPrompt = true;
let hardStatus = null;

globalThis.fetch = (url, init = {}) => {
  const target = String(url);
  if (!target.endsWith("/worlds:generate")) {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }
  const body = JSON.parse(init.body);
  attempts.push(body);

  if (hardStatus) {
    return Promise.resolve({
      ok: false, status: hardStatus, statusText: "nope",
      json: async () => ({ error: { message: "hard failure" } }),
    });
  }
  const modelOk = acceptModels.has(body.model);
  const textOk = acceptTextPrompt || body.world_prompt.text_prompt === undefined;
  if (!modelOk || !textOk) {
    return Promise.resolve({
      ok: false, status: 400, statusText: "Bad Request",
      json: async () => ({ error: { message: !modelOk ? "unknown model" : "text_prompt not allowed here" } }),
    });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ operation_id: "op-ok" }) });
};

const reset = () => {
  attempts = [];
  if (existsSync(CAPS)) writeFileSync(CAPS, "{}");
};

test("a wrong model id is walked past instead of failing the run", async () => {
  reset();
  const id = await startGeneration({ prompt: "a candy forest", displayName: "Candy", model: "marble-9.9-nonexistent" });
  assert.equal(id, "op-ok");

  assert.equal(attempts[0].model, "marble-9.9-nonexistent", "her configured model is tried first");
  assert.equal(attempts.at(-1).model, "marble-1.1", "and it lands on one the API accepts");
  assert.equal(readCaps().workingModel, "marble-1.1");
  assert.ok(readCaps().rejectedModels.includes("marble-9.9-nonexistent"));
});

test("the model that worked is tried first next time", async () => {
  attempts = [];
  await startGeneration({ prompt: "another world", displayName: "Two", model: "marble-9.9-nonexistent" });
  assert.equal(attempts[0].model, "marble-1.1", "no wasted round trip on a known-bad id");
  assert.equal(attempts.length, 1);
});

test("the exact rejected payload is written to the admin log", () => {
  const log = readFileSync(ERRORS, "utf8");
  assert.match(log, /REJECTED 400 POST \/worlds:generate/);
  assert.match(log, /marble-9\.9-nonexistent/, "the refused request itself must be recoverable");
  assert.match(log, /unknown model/);
});

test("multi-image drops text_prompt if the API refuses it", async () => {
  reset();
  acceptTextPrompt = false;
  const images = [
    { azimuth: 0, assetId: "a" }, { azimuth: 90, assetId: "b" },
    { azimuth: 180, assetId: "c" }, { azimuth: 270, assetId: "d" },
  ];
  const id = await startMultiImageGeneration({ images, prompt: "a candy forest", displayName: "Candy", model: "marble-1.1" });
  assert.equal(id, "op-ok");

  assert.ok(attempts[0].world_prompt.text_prompt, "her description is offered first");
  assert.equal(attempts.at(-1).world_prompt.text_prompt, undefined, "and dropped when refused");
  assert.equal(attempts.at(-1).world_prompt.reconstruct_images, true);
  assert.equal(attempts.at(-1).world_prompt.multi_image_prompt.length, 4);
  assert.equal(readCaps().multiImageTextPrompt, false);
});

test("once the shape is known, it stops offering the rejected one", async () => {
  attempts = [];
  await startMultiImageGeneration({
    images: [{ azimuth: 0, assetId: "a" }], prompt: "x", displayName: "y", model: "marble-1.1",
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].world_prompt.text_prompt, undefined);
});

test("multi-image keeps her description when the API accepts it", async () => {
  reset();
  acceptTextPrompt = true;
  attempts = [];
  await startMultiImageGeneration({
    images: [{ azimuth: 0, assetId: "a" }], prompt: "a chocolate river", displayName: "y", model: "marble-1.1",
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].world_prompt.text_prompt, "a chocolate river");
  assert.equal(readCaps().multiImageTextPrompt, true);
});

test("out of credits is never retried — that would just burn time", async () => {
  reset();
  hardStatus = 402;
  const err = await startGeneration({ prompt: "x", displayName: "y", model: "marble-1.1" }).catch((e) => e);
  hardStatus = null;
  assert.equal(err.code, "credits");
  assert.equal(attempts.length, 1, "exactly one attempt");
});

test("a bad key is never retried either", async () => {
  reset();
  hardStatus = 401;
  const err = await startGeneration({ prompt: "x", displayName: "y", model: "marble-1.1" }).catch((e) => e);
  hardStatus = null;
  assert.equal(err.code, "auth");
  assert.equal(attempts.length, 1);
});

test("when nothing is accepted, she still gets a kind message", async () => {
  reset();
  acceptModels = new Set();
  const err = await startGeneration({ prompt: "x", displayName: "y", model: "marble-1.1" }).catch((e) => e);
  acceptModels = new Set(["marble-1.1"]);
  assert.ok(attempts.length > 1, "every candidate was tried");
  assert.doesNotMatch(err.kidMessage, /model|400|payload|api/i);
});
