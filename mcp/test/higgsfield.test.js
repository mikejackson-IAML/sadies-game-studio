/**
 * Higgsfield request shapes, against a mock.
 *
 * The live hosts were blocked when this was written, so this is the only
 * verification available: it pins the endpoints, headers and payload shapes to
 * what real client code sends, so the first live run fails for interesting
 * reasons rather than typos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-hf-"));
mkdirSync(join(root, "config"), { recursive: true });
mkdirSync(join(root, "private"), { recursive: true });
process.env.STUDIO_ROOT = root;
process.env.HIGGSFIELD_API_KEY = "hf-test-key";
process.env.HIGGSFIELD_SECRET = "hf-test-secret";

const PHOTO = join(root, "private", "face.jpg");
writeFileSync(PHOTO, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const {
  createCharacter, generateSoulImage, waitForSoulImage, scrubHiggsfield, higgsfieldAvailable,
} = await import("../lib/higgsfield.js");

const calls = [];
let jobStatus = "completed";
let characterFails = false;

globalThis.fetch = (url, init = {}) => {
  const target = String(url);
  calls.push({ url: target, method: init.method || "GET", body: init.body, headers: init.headers });
  const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

  if (target.endsWith("/v1/custom-references")) {
    if (characterFails) {
      return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "image_base64 unsupported" }) });
    }
    return json({ id: "char-1", status: "ready" });
  }
  if (target.endsWith("/v1/text2image/soul")) return json({ id: "js-1" });
  if (target.includes("/v1/job-sets/")) {
    return json({ status: jobStatus, jobs: [{ status: jobStatus, results: { raw: { url: "https://cdn.hf.test/a.jpg" } } }] });
  }
  return json({});
};

test("both credentials are required", () => {
  assert.equal(higgsfieldAvailable(), true);
});

test("requests carry both secrets as headers, never in the URL", async () => {
  await createCharacter({ name: "sadie", imageUrls: ["https://example.test/a.jpg"] });
  const call = calls.at(-1);
  assert.equal(call.url, "https://platform.higgsfield.ai/v1/custom-references");
  assert.equal(call.headers["hf-api-key"], "hf-test-key");
  assert.equal(call.headers["hf-secret"], "hf-test-secret");
  assert.ok(!call.url.includes("hf-test-key"));
  assert.ok(!call.url.includes("hf-test-secret"));
});

test("character references from URLs use the documented shape", async () => {
  await createCharacter({ name: "sadie", imageUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"] });
  const body = JSON.parse(calls.at(-1).body);
  assert.equal(body.name, "sadie");
  assert.equal(body.input_images.length, 2);
  assert.deepEqual(body.input_images[0], { type: "image_url", image_url: "https://example.test/a.jpg" });
});

test("local photos are tried as base64 first, so nothing has to be published", async () => {
  await createCharacter({ name: "sadie", imageFiles: [PHOTO] });
  const body = JSON.parse(calls.at(-1).body);
  assert.equal(body.input_images[0].type, "image_base64");
  assert.ok(body.input_images[0].image_base64.length > 0);
  assert.ok(!JSON.stringify(body).includes("http"), "no URL should be involved");
});

test("if base64 is rejected it stops and explains, rather than publishing photos", async () => {
  characterFails = true;
  const err = await createCharacter({ name: "sadie", imageFiles: [PHOTO] }).catch((e) => e);
  characterFails = false;
  assert.equal(err.code, "needs_image_urls");
  assert.match(err.adminDetail, /PUBLICLY REACHABLE/);
  assert.match(err.adminDetail, /will not publish her photos/);
  assert.doesNotMatch(err.kidMessage, /url|api|400/i);
});

test("soul generation nests params and passes the character reference", async () => {
  const id = await generateSoulImage({ prompt: "a girl in a candy forest", characterReferenceId: "char-1" });
  assert.equal(id, "js-1");
  const call = calls.at(-1);
  assert.equal(call.url, "https://platform.higgsfield.ai/v1/text2image/soul");
  const body = JSON.parse(call.body);
  assert.ok(body.params, "payload must be wrapped in params");
  assert.equal(body.params.custom_reference_id, "char-1");
  assert.equal(body.params.prompt, "a girl in a candy forest");
  assert.equal(body.params.quality, "1080p");
});

test("polling returns the finished image URL", async () => {
  assert.equal(await waitForSoulImage("js-1"), "https://cdn.hf.test/a.jpg");
});

test("a content-filter block is explained kindly, with detail kept for Dad", async () => {
  jobStatus = "nsfw";
  const err = await waitForSoulImage("js-1").catch((e) => e);
  jobStatus = "completed";
  assert.equal(err.code, "higgsfield_nsfw");
  assert.doesNotMatch(err.kidMessage, /nsfw|filter|blocked/i);
  assert.match(err.adminDetail, /content filter/);
});

test("a failed job never leaks technical detail to her", async () => {
  jobStatus = "failed";
  const err = await waitForSoulImage("js-1").catch((e) => e);
  jobStatus = "completed";
  assert.equal(err.code, "higgsfield_failed");
  assert.doesNotMatch(err.kidMessage, /http|json|status|api/i);
});

test("both secrets are scrubbed from anything headed for a log", () => {
  const text = "boom hf-test-key and hf-test-secret";
  assert.ok(!scrubHiggsfield(text).includes("hf-test-key"));
  assert.ok(!scrubHiggsfield(text).includes("hf-test-secret"));
});
