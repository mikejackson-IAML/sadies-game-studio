/**
 * Concept-image generation for the World Design Studio.
 *
 * All iteration happens here rather than at the Marble layer: images cost
 * pennies and Marble generations are capped at one a day, so she can look at a
 * picture of her world and change her mind before anything expensive happens.
 *
 * Provider is behind a small adapter. Gemini is the default because it is the
 * only image API reachable from this environment, and because conditioning on
 * a reference image — which is how the four directional views are kept in the
 * same style as the hero — is what it is best at.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getApiKey as getWorldLabsKey, redact, ROOT } from "./config.js";
import { StudioError } from "./worldlabs.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Image keys never come from anywhere but the environment. */
export function getImageKey() {
  const fromEnv = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const envFile = readFileSync(join(ROOT, ".env"), "utf8");
    for (const line of envFile.split("\n")) {
      const m = line.match(/^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*(.+?)\s*$/);
      if (m) {
        const v = m[1].replace(/^["']|["']$/g, "").trim();
        if (v && !v.startsWith("AIza-xxxx") && !v.startsWith("your-")) return v;
      }
    }
  } catch {
    // No .env; environment-only is the normal case.
  }
  return null;
}

/**
 * Whether concept images can be drawn at all. Depends on the configured
 * provider, since each has its own credentials.
 */
export function imagesAvailable(config = {}) {
  if (config.imageProvider === "higgsfield") {
    return Boolean(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_SECRET);
  }
  return Boolean(getImageKey());
}

/**
 * Character art prompt: the same girl, restyled for the world she is standing
 * in. Deliberately illustrated rather than photorealistic — it suits a kid's
 * game, and it keeps a real child's face off a public page as a photograph.
 */
export function characterPrompt({ style, outfit, avatar }) {
  const bits = [
    "Full-body children's storybook illustration of the same young girl character,",
    "standing happily, friendly smile, facing the viewer.",
    avatar?.bodyColor ? `She is wearing ${avatar.bodyColor} clothes.` : "",
    outfit ? `She is wearing ${outfit} suited to this place.` : "",
    style ? `The setting around her is ${style.name}: ${style.palette.join(", ")}, ${style.lighting}.` : "",
    "Flat illustrated cartoon style with soft rounded shapes and clean outlines.",
    "NOT photorealistic. Plain simple background. No text, no words, no watermark.",
  ];
  return bits.filter(Boolean).join(" ");
}

/** Scrubs both API keys out of anything headed for a log. */
function scrub(text) {
  let out = redact(text);
  const key = getImageKey();
  if (key && key.length >= 8) out = out.split(key).join("[key hidden]");
  return out.replace(/\bAIza[A-Za-z0-9_-]{10,}/g, "[key hidden]");
}

const STYLE_SUFFIX =
  "Children's storybook concept art, warm and inviting, bright saturated colours, " +
  "soft rounded shapes, no text, no words, no letters, no people, no characters, " +
  "no watermark. A wide establishing view of the place itself.";

/**
 * Generates one image. `referenceImages` are passed back to the model so a
 * follow-up view matches the first one's style — that is the whole trick
 * behind the four directional images looking like the same world.
 */
async function generateGemini({ prompt, referenceImages = [], model }) {
  const key = getImageKey();
  if (!key) {
    throw new StudioError(
      "I can't draw pictures right now — that part of the studio needs a magic key from your dad. We can still design your world!",
      "GEMINI_API_KEY is not set",
      "no_image_key",
    );
  }

  const parts = [{ text: `${prompt}\n\n${STYLE_SUFFIX}` }];
  for (const image of referenceImages) {
    parts.push({ inline_data: { mime_type: image.mimeType || "image/jpeg", data: image.base64 } });
  }

  let response;
  try {
    response = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new StudioError(
      "I couldn't reach my drawing pens just now. Let's try again in a minute!",
      `network error calling the image API: ${err.message}`,
      "image_network",
    );
  }

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      detail = JSON.stringify(await response.json()).slice(0, 400);
    } catch {
      // Body was not JSON; the status alone is enough for the admin log.
    }
    const kid =
      response.status === 429
        ? "My drawing pens need a little rest — let's wait a minute and try again!"
        : response.status === 401 || response.status === 403
          ? "My drawing pens didn't recognise the magic key. Ask your dad to check it — nothing you did!"
          : "The drawing didn't work that time. Let's try again!";
    throw new StudioError(kid, `image API ${response.status}: ${scrub(detail)}`, "image_api");
  }

  const data = await response.json();
  const candidates = data?.candidates?.[0]?.content?.parts ?? [];
  const image = candidates.find((p) => p.inline_data?.data || p.inlineData?.data);
  if (!image) {
    throw new StudioError(
      "My pens drew a blank that time! Let's try describing it a little differently.",
      `no image part in response: ${scrub(JSON.stringify(data).slice(0, 300))}`,
      "image_empty",
    );
  }
  const inline = image.inline_data || image.inlineData;
  return {
    buffer: Buffer.from(inline.data, "base64"),
    mimeType: inline.mime_type || inline.mimeType || "image/png",
  };
}

/**
 * Higgsfield Soul, used when a character reference ("Soul ID") is configured.
 * Its consistency comes from that stored reference rather than from reference
 * images passed per call, so `referenceImages` is unused here.
 */
async function generateHiggsfield({ prompt, config }) {
  const { generateSoulImage, waitForSoulImage } = await import("./higgsfield.js");
  const jobSetId = await generateSoulImage({
    prompt,
    characterReferenceId: config.characterReferenceId || null,
    quality: config.higgsfieldQuality || "1080p",
    widthAndHeight: config.higgsfieldSize || "1152x2048",
  });
  const url = await waitForSoulImage(jobSetId);

  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) {
    throw new StudioError(
      "The drawing finished but I couldn't bring it home. Let's try again!",
      `failed to download Higgsfield result: HTTP ${response.status}`,
      "image_download",
    );
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") || "image/jpeg",
  };
}

const PROVIDERS = { gemini: generateGemini, higgsfield: generateHiggsfield };

/**
 * Generates an image and writes it to disk.
 * Returns { file, bytes } or throws a StudioError with a kid-safe message.
 */
export async function makeConceptImage({ prompt, referenceFiles = [], outPath, config }) {
  const provider = PROVIDERS[config.imageProvider] || PROVIDERS.gemini;
  const referenceImages = referenceFiles.map((file) => ({
    base64: readFileSync(file).toString("base64"),
    mimeType: file.endsWith(".png") ? "image/png" : "image/jpeg",
  }));

  const { buffer } = await provider({
    prompt,
    referenceImages,
    model: config.imageModel || "gemini-3.1-flash-image",
    config,
  });

  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, buffer);
  return { file: outPath, bytes: buffer.length };
}

/** Turns her interview answers plus a style recipe into an image prompt. */
export function heroPrompt({ answers, style }) {
  const lines = [
    `A wide establishing view of ${answers.place || "a magical place"}.`,
    answers.inhabitants ? `${answers.inhabitants} live here.` : "",
    answers.secret ? `Somewhere in this view: ${answers.secret}.` : "",
    answers.timeOfDay ? `It is ${answers.timeOfDay}.` : "",
    answers.weather ? `The weather is ${answers.weather}.` : "",
    answers.colors ? `The colours everywhere are ${answers.colors}.` : "",
  ];
  if (style) {
    lines.push(
      `Style: ${style.name}. Palette: ${style.palette.join(", ")}. ` +
        `Lighting: ${style.lighting}. Materials: ${style.materials}. ` +
        `Feel: ${style.descriptors.join(", ")}.`,
    );
  }
  return lines.filter(Boolean).join(" ");
}

/** Prompt for one of the four compass views, anchored to the hero image. */
export function directionPrompt({ direction, what, answers }) {
  return (
    `This is the same world as the picture provided — keep the exact same art style, ` +
    `palette, lighting and mood. Now show what you see when you look ${direction} ` +
    `from the middle of this world: ${what}. ` +
    (answers.timeOfDay ? `It is still ${answers.timeOfDay}. ` : "") +
    `Wide establishing view from standing height, same place, different direction.`
  );
}

void getWorldLabsKey;
