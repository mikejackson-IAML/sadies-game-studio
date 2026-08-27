/**
 * The World Design Studio end to end, against a mocked Gemini and a mocked
 * Marble. Proves the expensive call is reached only through the design flow,
 * that the four compass views go to Marble at the right bearings, and that the
 * World Card ends up next to the world it produced.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "studio-design-"));
for (const d of ["logs", "config", "worlds"]) mkdirSync(join(root, d), { recursive: true });
process.env.STUDIO_ROOT = root;
process.env.WORLDLABS_API_KEY = "test-world-key";
process.env.GEMINI_API_KEY = "test-image-key";

writeFileSync(join(root, "config", "studio.json"), JSON.stringify({
  dailyWorldLimit: 1, timezone: "America/Chicago", marbleModel: "marble-1.1-plus",
  splatQuality: "500k", imageProvider: "gemini", imageModel: "gemini-3.1-flash-image",
  maxHeroRevisions: 2,
}));
writeFileSync(join(root, "config", "styles.json"), JSON.stringify({
  styles: [
    { id: "candy-kingdom", name: "Candy Kingdom", emoji: "🍭", blurb: "Sweets!", palette: ["pink", "mint"],
      lighting: "bright afternoon", materials: "hard candy", descriptors: ["whimsical"], mood: "bright" },
    { id: "underwater-reef", name: "Underwater Reef", emoji: "🐠", blurb: "Coral!", palette: ["turquoise"],
      lighting: "rippling caustics", materials: "coral", descriptors: ["floating"], mood: "watery" },
  ],
}));

const { listStyles, designWorld, reviseHero, previewWorld, makeWorld } = await import("../lib/tools.js");
const { paths } = await import("../lib/config.js");
const { readDraft, assemblePrompt } = await import("../lib/worldcard.js");

const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const WORLD = {
  world_id: "wl-multi-1",
  assets: {
    splats: { spz_urls: { "500k": "https://cdn.example.test/w.spz" } },
    thumbnail_url: "https://cdn.example.test/t.jpg",
  },
};

const calls = [];
let imageFailures = 0;

globalThis.fetch = (url, init = {}) => {
  const target = String(url);
  calls.push({ url: target, method: init.method || "GET", body: init.body, headers: init.headers });
  const json = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

  if (target.includes("generativelanguage.googleapis.com")) {
    if (imageFailures > 0) {
      imageFailures--;
      return Promise.resolve({ ok: false, status: 429, statusText: "Too Many Requests", json: async () => ({}) });
    }
    return json({
      candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/jpeg", data: PIXEL.toString("base64") } }] } }],
    });
  }
  if (target.endsWith("/media-assets:prepare_upload")) {
    return json({
      media_asset: { media_asset_id: `ma-${calls.length}` },
      upload_info: { upload_url: "https://upload.example.test/put", upload_method: "PUT", required_headers: {} },
    });
  }
  if (target.startsWith("https://upload.example.test")) return Promise.resolve({ ok: true, status: 200 });
  if (target.endsWith("/worlds:generate")) return json({ operation_id: "op-multi" });
  if (target.includes("/worlds:expand")) {
    return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) });
  }
  if (target.includes("/operations/")) return json({ done: true, response: WORLD });
  if (target.startsWith("https://cdn.example.test/")) {
    return Promise.resolve({ ok: true, status: 200, body: {}, arrayBuffer: async () => PIXEL.buffer });
  }
  return json({});
};

const textOf = (r) => r.content[0].text;
const ANSWERS = {
  place: "a candy forest with a chocolate river",
  inhabitants: "friendly gummy bears",
  colors: "pink and mint green",
  timeOfDay: "sunset",
  weather: "warm and still",
  secret: "a tiny door in the biggest lollipop tree",
  sounds: "bubbling chocolate and birds",
};

let draftId;

test("the style menu offers the built-in styles and explains mixing", () => {
  const text = textOf(listStyles());
  assert.match(text, /Candy Kingdom/);
  assert.match(text, /Underwater Reef/);
  assert.match(text, /mix any TWO/i);
});

test("design_world saves a World Card draft and draws one hero image", async () => {
  const result = await designWorld({
    name: "Candy Forest", gameType: "explore", answers: ANSWERS,
    styleIds: ["candy-kingdom", "underwater-reef"],
  });
  const text = textOf(result);
  assert.match(text, /DESIGN STARTED/);
  assert.match(text, /NO MARBLE GENERATION HAS HAPPENED/);

  draftId = text.match(/Draft id: (\S+)/)[1];
  assert.ok(existsSync(join(root, "worlds", "_drafts", draftId, "hero.jpg")));
  assert.ok(existsSync(join(root, "worlds", "_drafts", draftId, "world-card.md")));

  // Exactly one image so far, and no Marble call at all.
  const images = calls.filter((c) => c.url.includes("generativelanguage"));
  assert.equal(images.length, 1);
  assert.equal(calls.filter((c) => c.url.includes("api.worldlabs.ai")).length, 0);

  // The key travels in a header, never in the URL.
  assert.ok(!images[0].url.includes("test-image-key"));
  assert.equal(images[0].headers["x-goog-api-key"], "test-image-key");
});

test("mixing two styles blends both recipes into the prompt", () => {
  const prompt = assemblePrompt(readDraft(draftId));
  assert.match(prompt, /hard candy/);
  assert.match(prompt, /coral/);
  assert.match(prompt, /nooks/, "the explore game type must shape the space");
});

test("hero redraws are capped so the image bill stays bounded", async () => {
  assert.match(textOf(await reviseHero({ draftId, change: "more pink" })), /REDRAWN/);
  assert.match(textOf(await reviseHero({ draftId, change: "even more pink" })), /REDRAWN/);
  const third = textOf(await reviseHero({ draftId, change: "still more pink" }));
  assert.match(third, /used all 2 redraws/);
  assert.equal(readDraft(draftId).heroRevisions, 2);
});

test("preview_world asks for missing compass answers instead of guessing", async () => {
  const text = textOf(await previewWorld({ draftId, directions: { front: "a chocolate river" } }));
  assert.match(text, /Still need the compass answers/);
  assert.match(text, /right|back|left/);
  assert.equal(calls.filter((c) => c.url.includes("api.worldlabs.ai")).length, 0);
});

test("preview_world draws all four compass views from the hero image", async () => {
  const before = calls.filter((c) => c.url.includes("generativelanguage")).length;
  const text = textOf(await previewWorld({
    draftId,
    directions: { right: "lollipop trees", back: "a gummy bear village", left: "a marshmallow hill" },
  }));
  assert.match(text, /WORLD CARD FINISHED/);
  assert.match(text, /STILL NOTHING HAS BEEN USED UP/);
  assert.match(text, /READ HER CARD BACK/);

  const made = calls.filter((c) => c.url.includes("generativelanguage")).slice(before);
  assert.equal(made.length, 4);
  // Each directional call must send the hero back as a style reference.
  for (const call of made) {
    const parts = JSON.parse(call.body).contents[0].parts;
    assert.ok(parts.some((p) => p.inline_data), "directional images must be conditioned on the hero");
  }
  for (const d of ["front", "right", "back", "left"]) {
    assert.ok(existsSync(join(root, "worlds", "_drafts", draftId, `${d}.jpg`)), `${d}.jpg missing`);
  }
});

test("make_world sends the four views to Marble at the right compass bearings", async () => {
  const result = await makeWorld({ draftId, name: "Candy Forest" });
  assert.match(textOf(result), /SUCCESS/);

  const generate = calls.filter((c) => c.url.endsWith("/worlds:generate")).pop();
  const payload = JSON.parse(generate.body);
  assert.equal(payload.world_prompt.type, "multi-image");
  assert.equal(payload.world_prompt.reconstruct_images, true);

  const azimuths = payload.world_prompt.multi_image_prompt.map((p) => p.azimuth);
  assert.deepEqual(azimuths, [0, 90, 180, 270], "front, right, back, left");
  for (const entry of payload.world_prompt.multi_image_prompt) {
    assert.equal(entry.content.source, "media_asset");
    assert.match(entry.content.media_asset_id, /^ma-/);
  }
  assert.match(payload.world_prompt.text_prompt, /chocolate river/);
});

test("the World Card and pictures move in next to the finished world", () => {
  const registry = JSON.parse(readFileSync(paths.registry, "utf8"));
  const world = registry.worlds.at(-1);
  assert.equal(world.builtFrom, "four-directional-images");
  assert.equal(world.mood, "bright");
  assert.deepEqual(world.styleIds, ["candy-kingdom", "underwater-reef"]);
  assert.ok(world.card.answers.secret.includes("tiny door"));

  assert.ok(existsSync(join(root, "worlds", world.id, "world-card.md")));
  assert.ok(existsSync(join(root, "worlds", world.id, "hero.jpg")));
  assert.ok(existsSync(join(root, "worlds", world.id, "front.jpg")));
  assert.ok(!existsSync(join(root, "worlds", "_drafts", draftId)), "the draft folder is cleaned up");
});

test("her finished world becomes a style other worlds can be built in", () => {
  const text = textOf(listStyles());
  assert.match(text, /HER OWN WORLDS/);
  assert.match(text, /world:candy-forest/);
});

test("designing is still free once the daily world is gone", async () => {
  const before = calls.filter((c) => c.url.includes("api.worldlabs.ai")).length;
  const design = await designWorld({
    name: "Dino Island", gameType: "platformer",
    answers: { place: "a dinosaur island", secret: "a volcano cave" },
    styleIds: [],
  });
  const secondDraft = textOf(design).match(/Draft id: (\S+)/)[1];
  await previewWorld({
    draftId: secondDraft,
    directions: { front: "a volcano", right: "jungle", back: "the sea", left: "cliffs" },
  });

  const blocked = textOf(await makeWorld({ draftId: secondDraft, name: "Dino Island" }));
  assert.match(blocked, /NO GENERATION HAPPENED/);
  assert.match(blocked, /World Card AND the pictures/);
  assert.equal(
    calls.filter((c) => c.url.includes("api.worldlabs.ai")).length, before,
    "no Marble call may happen once the limit is reached",
  );

  // The design survives for tomorrow, pictures and all.
  assert.ok(existsSync(join(root, "worlds", "_drafts", secondDraft, "world-card.md")));
  assert.match(readFileSync(paths.tomorrow, "utf8"), /Dino Island/);
});

test("an image failure never leaks anything technical to her", async () => {
  imageFailures = 1;
  const text = textOf(await reviseHero({ draftId: "nope-not-real", change: "x" }));
  assert.doesNotMatch(text, /429|http|api|key/i);
  imageFailures = 0;
});
