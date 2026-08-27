import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { paths, getApiKey, redact } from "./config.js";

const BASE_URL = "https://api.worldlabs.ai/marble/v1";
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const CAPS_FILE = join(paths.root, "logs", "api-capabilities.json");

/**
 * An error carrying two messages: one an 8-year-old can read, and one with the
 * technical detail for Dad's log. The kid-facing text NEVER contains API
 * responses, URLs, status codes, or anything resembling a key.
 */
export class StudioError extends Error {
  constructor(kidMessage, adminDetail, code = "unknown") {
    super(kidMessage);
    this.name = "StudioError";
    this.kidMessage = kidMessage;
    this.adminDetail = redact(adminDetail ?? kidMessage);
    this.code = code;
  }
}

function authHeaders() {
  const key = getApiKey();
  if (!key) {
    throw new StudioError(
      "My magic key for the world machine is missing! Ask Dad to check the studio setup — nothing is broken, and none of your work is lost.",
      "WORLDLABS_API_KEY is not set in the environment or .env",
      "no_key",
    );
  }
  return { "WLT-Api-Key": key, "Content-Type": "application/json" };
}

/** Translates an HTTP failure into something friendly, with detail kept for Dad. */
async function toStudioError(response) {
  let detail = "";
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    detail = `${response.status} ${response.statusText}`;
  }
  const admin = `World Labs API ${response.status}: ${detail}`;
  const withStatus = (err) => Object.assign(err, { httpStatus: response.status });

  if (response.status === 401 || response.status === 403) {
    return withStatus(new StudioError(
      "The world machine didn't recognise my magic key. Ask Dad to check it — this isn't anything you did!",
      admin,
      "auth",
    ));
  }
  if (response.status === 402) {
    return withStatus(new StudioError(
      "We're out of world-making sparkles for now! Ask Dad to top them up. Everything you've already made is safe.",
      `${admin} — NOTE: platform.worldlabs.ai API credits are separate from marble.worldlabs.ai web credits`,
      "credits",
    ));
  }
  if (response.status === 429) {
    return withStatus(new StudioError(
      "The world machine is really busy right now! Let's wait a few minutes and try again.",
      admin,
      "rate_limit",
    ));
  }
  return withStatus(new StudioError(
    "The world machine had a hiccup and couldn't build your world. Nothing is lost — we can try again!",
    admin,
    "api_error",
  ));
}

async function apiPost(path, body) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError(
      "I couldn't reach the world machine — it might be sleeping. Let's try again in a little bit!",
      `network error on POST ${path}: ${err.message}`,
      "network",
    );
  }
  if (!response.ok) {
    const err = await toStudioError(response);
    err.requestPath = path;
    err.requestBody = body;
    logRejectedRequest(path, body, err);
    throw err;
  }
  return response.json();
}

async function apiGet(path) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError(
      "I couldn't reach the world machine — it might be sleeping. Let's try again in a little bit!",
      `network error on GET ${path}: ${err.message}`,
      "network",
    );
  }
  if (!response.ok) throw await toStudioError(response);
  return response.json();
}

const operationId = (op) =>
  op?.operation_id || (typeof op?.name === "string" ? op.name.split("/").pop() : null) || op?.id;

const worldIdOf = (world) =>
  world?.world_id || world?.id || (typeof world?.name === "string" ? world.name.split("/").pop() : null);

/** Flattens the world object into the asset URLs the studio actually uses. */
export function extractAssets(world, quality = "500k") {
  const assets = world?.assets ?? {};
  const spz = assets.splats?.spz_urls ?? {};
  return {
    splat: spz[quality] ?? spz["500k"] ?? spz["100k"] ?? spz.full_res ?? null,
    splatQuality: spz[quality] ? quality : spz["500k"] ? "500k" : spz["100k"] ? "100k" : "full_res",
    mesh: assets.mesh?.collider_mesh_url ?? null,
    panorama: assets.imagery?.pano_url ?? null,
    thumbnail: assets.thumbnail_url ?? null,
    caption: assets.caption ?? null,
  };
}

// --------------------------------------------------- capability cache + logs

function readCaps() {
  try {
    return JSON.parse(readFileSync(CAPS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCaps(patch) {
  const caps = { ...readCaps(), ...patch, updatedAtUtc: new Date().toISOString() };
  try {
    mkdirSync(join(CAPS_FILE, ".."), { recursive: true });
    writeFileSync(CAPS_FILE, `${JSON.stringify(caps, null, 2)}\n`);
  } catch {
    // The cache is an optimisation, never a requirement.
  }
  return caps;
}

/**
 * Writes the exact request the API refused into the admin log.
 *
 * The Marble API surface here was reconstructed from client code rather than
 * official docs, so when something is rejected the single most useful thing is
 * the payload that was sent. Redacted, and Dad-only.
 */
function logRejectedRequest(path, body, err) {
  try {
    mkdirSync(join(CAPS_FILE, ".."), { recursive: true });
    const entry = [
      `[${new Date().toISOString()}] REJECTED ${err.httpStatus} POST ${path}`,
      `  reason: ${err.adminDetail}`,
      `  request: ${redact(JSON.stringify(body))}`,
      "",
    ].join("\n");
    writeFileSync(join(CAPS_FILE, "..", "errors.log"), entry, { flag: "a" });
  } catch {
    // Logging must never break a generation.
  }
}

// ---------------------------------------------------- model + payload probing

/**
 * Model ids seen in the wild, newest first. The id is the likeliest thing to be
 * wrong, since it is the one value that changes as Marble ships new versions.
 */
const MODEL_CANDIDATES = ["marble-1.1-plus", "marble-1.1", "Marble 0.1-plus", "Marble 0.1"];

/** Only these mean "your payload is wrong" — never auth, billing or rate limits. */
const PAYLOAD_REJECTIONS = new Set([400, 404, 422]);

function orderedModels(preferred) {
  const caps = readCaps();
  const rejected = new Set(caps.rejectedModels || []);
  const ordered = [...new Set([caps.workingModel, preferred, ...MODEL_CANDIDATES].filter(Boolean))];
  const viable = ordered.filter((m) => !rejected.has(m));
  return viable.length ? viable : ordered;
}

function rememberRejectedModel(model) {
  const caps = readCaps();
  const rejected = new Set(caps.rejectedModels || []);
  rejected.add(model);
  writeCaps({ rejectedModels: [...rejected] });
}

/**
 * Posts a generate request, walking the candidate variants until one is
 * accepted, and remembering what worked.
 *
 * Retries are safe: a payload rejection means no operation was created and no
 * credits moved. Anything else — auth, credits, rate limit, network — is
 * rethrown immediately rather than retried.
 */
async function generateWithFallbacks(variants, { onNote } = {}) {
  let lastError = null;

  for (const variant of variants) {
    try {
      const op = await apiPost("/worlds:generate", variant.body);
      if (variant.remember) writeCaps(variant.remember);
      return op;
    } catch (err) {
      const retryable = err instanceof StudioError && PAYLOAD_REJECTIONS.has(err.httpStatus);
      if (!retryable) throw err;
      lastError = err;
      if (variant.onReject) variant.onReject();
      onNote?.(`variant rejected (${err.httpStatus}): ${variant.note}`);
    }
  }
  throw lastError;
}

// ------------------------------------------------------------------ generate

export async function startGeneration({ prompt, displayName, model, onNote }) {
  const variants = orderedModels(model).map((candidate) => ({
    note: `model=${candidate}`,
    body: {
      model: candidate,
      display_name: displayName,
      world_prompt: { type: "text", text_prompt: prompt },
    },
    remember: { workingModel: candidate },
    onReject: () => rememberRejectedModel(candidate),
  }));

  const op = await generateWithFallbacks(variants, { onNote });
  const id = operationId(op);
  if (!id) {
    throw new StudioError(
      "The world machine answered in a way I didn't understand. Let's try again!",
      `no operation id in generate response: ${JSON.stringify(op).slice(0, 400)}`,
      "bad_response",
    );
  }
  return id;
}

export async function waitForWorld(opId, { onProgress } = {}) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const op = await apiGet(`/operations/${opId}`);
    const progress = op?.metadata?.progress ?? {};

    if (op?.done) {
      if (op.error) {
        throw new StudioError(
          "The world machine tried really hard but couldn't finish this world. Let's change the idea a little and try again!",
          `operation failed: ${JSON.stringify(op.error).slice(0, 400)}`,
          "generation_failed",
        );
      }
      return op.response;
    }
    onProgress?.(progress.status ?? "working", progress.description ?? "");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new StudioError(
    "This world is taking a really long time to build. It might still show up — let's check again in a few minutes!",
    `polling timed out after ${POLL_TIMEOUT_MS}ms for operation ${opId}`,
    "timeout",
  );
}

export const getWorld = (worldId) => apiGet(`/worlds/${worldId}`).then((d) => d?.world ?? d);

// ------------------------------------------------------------------ download

export async function downloadTo(url, destPath) {
  mkdirSync(join(destPath, ".."), { recursive: true });
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  } catch (err) {
    throw new StudioError(
      "Your world was built, but I had trouble bringing it home. Let's try again in a minute!",
      `download failed for ${url}: ${err.message}`,
      "download",
    );
  }
  if (!response.ok || !response.body) {
    throw new StudioError(
      "Your world was built, but I had trouble bringing it home. Let's try again in a minute!",
      `download failed: HTTP ${response.status} for ${url}`,
      "download",
    );
  }
  const buf = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buf);
  return buf.length;
}

// -------------------------------------------------------- media asset upload

/**
 * Uploads one image to Marble in the two steps its API requires: ask for a
 * signed URL, then push the bytes to it. Returns the media_asset_id used to
 * reference the image in a multi-image world prompt.
 */
export async function uploadImage(filePath) {
  const fileName = filePath.split("/").pop();
  const extension = (fileName.split(".").pop() || "jpg").toLowerCase();

  const prepared = await apiPost("/media-assets:prepare_upload", {
    file_name: fileName,
    extension,
    kind: "image",
  });

  const assetId = prepared?.media_asset?.media_asset_id;
  const upload = prepared?.upload_info;
  if (!assetId || !upload?.upload_url) {
    throw new StudioError(
      "I had trouble sending your picture to the world machine. Let's try again!",
      `prepare_upload gave no upload info: ${JSON.stringify(prepared).slice(0, 300)}`,
      "upload_prepare",
    );
  }

  let response;
  try {
    response = await fetch(upload.upload_url, {
      method: upload.upload_method || "PUT",
      headers: { ...(upload.required_headers || {}) },
      body: readFileSync(filePath),
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (err) {
    throw new StudioError(
      "I had trouble sending your picture to the world machine. Let's try again!",
      `upload failed for ${fileName}: ${err.message}`,
      "upload",
    );
  }
  if (!response.ok) {
    throw new StudioError(
      "I had trouble sending your picture to the world machine. Let's try again!",
      `upload failed: HTTP ${response.status} for ${fileName}`,
      "upload",
    );
  }
  return assetId;
}

/** Compass direction -> Marble azimuth in degrees (0 is straight ahead). */
export const AZIMUTH = { front: 0, right: 90, back: 180, left: 270 };

/**
 * Builds a world from her four directional concept images, each placed at the
 * compass bearing she described it at, plus the assembled text prompt.
 */
export async function startMultiImageGeneration({ images, prompt, displayName, model, onNote }) {
  const multiImagePrompt = images.map(({ azimuth, assetId }) => ({
    azimuth,
    content: { source: "media_asset", media_asset_id: assetId },
  }));

  // Reference clients send multi_image_prompt with no text_prompt. Carrying her
  // written description too should work and is better if it does, so try it
  // first and fall back to the shape known to be accepted.
  const caps = readCaps();
  const shapes = caps.multiImageTextPrompt === false ? [false] : [true, false];

  const variants = [];
  for (const withText of shapes) {
    for (const candidate of orderedModels(model)) {
      const worldPrompt = {
        type: "multi-image",
        multi_image_prompt: multiImagePrompt,
        reconstruct_images: true,
      };
      if (withText) worldPrompt.text_prompt = prompt;
      variants.push({
        note: `model=${candidate} text_prompt=${withText}`,
        body: { model: candidate, display_name: displayName, world_prompt: worldPrompt },
        remember: { workingModel: candidate, multiImageTextPrompt: withText },
      });
    }
  }

  const op = await generateWithFallbacks(variants, { onNote });
  const id = operationId(op);
  if (!id) {
    throw new StudioError(
      "The world machine answered in a way I didn't understand. Let's try again!",
      `no operation id in multi-image generate response: ${JSON.stringify(op).slice(0, 400)}`,
      "bad_response",
    );
  }
  return id;
}

// ------------------------------------------------- expansion capability probe

/**
 * As of this build the public World API exposes no endpoint for expanding an
 * existing world — expansion is an interactive feature of the Marble web app,
 * and marble-1.1-plus expands automatically *within* a single generation.
 *
 * Rather than hard-code that assumption forever, probe for the endpoint and
 * cache the answer for a week. If World Labs ships one, "add to my world"
 * upgrades itself without a code change; until then we fall back to a remix.
 */
export async function expansionSupported() {
  const cached = readCaps();
  if (typeof cached.expandEndpoint === "boolean" && cached.expandCheckedAtUtc) {
    const age = Date.now() - new Date(cached.expandCheckedAtUtc).getTime();
    if (age < 7 * 86400_000) return cached.expandEndpoint;
  }

  let supported = false;
  try {
    // An empty body: a real endpoint rejects it as malformed (400/422), a
    // missing one 404s. Either way no world is generated and no credits move.
    const response = await fetch(`${BASE_URL}/worlds:expand`, {
      method: "POST",
      headers: authHeaders(),
      body: "{}",
      signal: AbortSignal.timeout(20_000),
    });
    supported = [400, 422].includes(response.status);
  } catch {
    supported = false;
  }

  writeCaps({ expandEndpoint: supported, expandCheckedAtUtc: new Date().toISOString() });
  return supported;
}

/** Best-effort real expansion. Throws so the caller can fall back to a remix. */
export async function startExpansion({ sourceWorldId, prompt, displayName, model }) {
  const op = await apiPost("/worlds:expand", {
    model,
    display_name: displayName,
    source_world_id: sourceWorldId,
    world_prompt: { type: "text", text_prompt: prompt },
  });
  const id = operationId(op);
  if (!id) throw new StudioError("Expansion answered oddly.", "no operation id from expand", "bad_response");
  return id;
}

export { worldIdOf };
