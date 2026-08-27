/**
 * Higgsfield client — Soul image generation with a character reference.
 *
 * Used for Sadie's character art: one "Soul ID" built from her reference
 * photos, then re-rendered in each world's style so the same character shows up
 * everywhere.
 *
 * NOTE: this was written against the public API surface as used by working
 * client code; the Higgsfield hosts are blocked by the egress policy of the
 * environment it was built in, so it has never been run against the live
 * service. `npm run smoke:higgsfield` is the first real exercise of it.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { StudioError } from "./worldlabs.js";
import { ROOT } from "./config.js";

const BASE_URL = "https://platform.higgsfield.ai";
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

export function getHiggsfieldKeys() {
  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  const secret = process.env.HIGGSFIELD_SECRET?.trim();
  if (key && secret) return { key, secret };

  try {
    const env = readFileSync(`${ROOT}/.env`, "utf8");
    const pick = (name) => {
      const m = env.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m"));
      const v = m?.[1]?.replace(/^["']|["']$/g, "").trim();
      return v && !v.startsWith("hf-xxxx") ? v : null;
    };
    const k = pick("HIGGSFIELD_API_KEY");
    const s = pick("HIGGSFIELD_SECRET");
    if (k && s) return { key: k, secret: s };
  } catch {
    // Environment-only is the normal case.
  }
  return null;
}

export const higgsfieldAvailable = () => Boolean(getHiggsfieldKeys());

function headers() {
  const keys = getHiggsfieldKeys();
  if (!keys) {
    throw new StudioError(
      "My character pens aren't set up yet. Ask your dad — nothing you did!",
      "HIGGSFIELD_API_KEY and HIGGSFIELD_SECRET must both be set",
      "no_higgsfield_key",
    );
  }
  return {
    "hf-api-key": keys.key,
    "hf-secret": keys.secret,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Keeps both Higgsfield secrets out of anything headed for a log. */
export function scrubHiggsfield(text) {
  let out = String(text ?? "");
  const keys = getHiggsfieldKeys();
  if (keys) {
    for (const value of [keys.key, keys.secret]) {
      if (value && value.length >= 8) out = out.split(value).join("[key hidden]");
    }
  }
  return out;
}

async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof StudioError) throw err;
    throw new StudioError(
      "I couldn't reach my character pens. Let's try again in a minute!",
      `network error on ${method} ${path}: ${scrubHiggsfield(err.message)}`,
      "higgsfield_network",
    );
  }

  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      detail = JSON.stringify(await response.json()).slice(0, 400);
    } catch {
      // Non-JSON body; the status is enough for the admin log.
    }
    const kid =
      response.status === 401 || response.status === 403
        ? "My character pens didn't recognise the magic key. Ask your dad to check it!"
        : response.status === 402
          ? "We're out of drawing sparkles! Ask your dad to top them up."
          : response.status === 429
            ? "My character pens need a rest — let's wait a minute and try again."
            : "That drawing didn't work. Let's try again!";
    throw new StudioError(kid, `Higgsfield ${response.status} on ${path}: ${scrubHiggsfield(detail)}`, "higgsfield_api");
  }
  return response.json();
}

/**
 * Creates the character reference ("Soul ID") from reference photos.
 *
 * The documented shape takes image URLs. Base64 is attempted first when local
 * files are given, because hosting a child's photos at a public URL — even
 * briefly — is a real exposure and should be a deliberate choice, not something
 * this code does on its own. If base64 is rejected, the caller is told to
 * supply URLs explicitly.
 */
export async function createCharacter({ name, imageUrls = [], imageFiles = [] }) {
  if (!imageUrls.length && !imageFiles.length) {
    throw new StudioError(
      "I need some pictures first!",
      "createCharacter requires at least one image URL or file",
      "no_images",
    );
  }

  if (imageFiles.length) {
    const inputImages = imageFiles.map((file) => ({
      type: "image_base64",
      image_base64: readFileSync(file).toString("base64"),
      file_name: basename(file),
    }));
    try {
      return await request("/v1/custom-references", {
        method: "POST",
        body: { name, input_images: inputImages },
      });
    } catch (err) {
      if (err.code !== "higgsfield_api") throw err;
      throw new StudioError(
        "I couldn't make your character from those pictures.",
        `${err.adminDetail}\n\nBase64 reference images were rejected. The documented shape is ` +
          `{"type":"image_url","image_url":"..."} with a PUBLICLY REACHABLE url. ` +
          `Host the photos somewhere you control and re-run with --urls, or use a short-lived signed URL. ` +
          `This code will not publish her photos to make a URL on its own.`,
        "needs_image_urls",
      );
    }
  }

  return request("/v1/custom-references", {
    method: "POST",
    body: {
      name,
      input_images: imageUrls.map((url) => ({ type: "image_url", image_url: url })),
    },
  });
}

export const listCharacters = () => request("/v1/custom-references/list");
export const getCharacter = (id) => request(`/v1/custom-references/${id}`);
export const listSoulStyles = () => request("/v1/text2image/soul-styles");

/** Starts a Soul text-to-image job. Returns the job set id to poll. */
export async function generateSoulImage({
  prompt, characterReferenceId, styleId, quality = "1080p",
  widthAndHeight = "1152x2048", batchSize = 1, enhancePrompt = false,
}) {
  const params = {
    prompt,
    width_and_height: widthAndHeight,
    enhance_prompt: enhancePrompt,
    quality,
    batch_size: batchSize,
  };
  if (characterReferenceId) params.custom_reference_id = characterReferenceId;
  if (styleId) params.style_id = styleId;

  const jobSet = await request("/v1/text2image/soul", { method: "POST", body: { params } });
  const id = jobSet?.id || jobSet?.job_set_id;
  if (!id) {
    throw new StudioError(
      "The drawing machine answered oddly. Let's try again!",
      `no job set id in response: ${JSON.stringify(jobSet).slice(0, 300)}`,
      "higgsfield_bad_response",
    );
  }
  return id;
}

/** Pulls the first finished image URL out of a job set, whatever its shape. */
function firstResultUrl(jobSet) {
  const jobs = jobSet?.jobs || [];
  for (const job of jobs) {
    const results = job.results || job.result || {};
    const url = results.raw?.url || results.min?.url || results.url || job.url;
    if (url) return url;
  }
  return jobSet?.results?.[0]?.url ?? null;
}

export async function waitForSoulImage(jobSetId, { onProgress } = {}) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const jobSet = await request(`/v1/job-sets/${jobSetId}`);
    const status = jobSet?.status || jobSet?.jobs?.[0]?.status || "in_progress";

    if (status === "completed") {
      const url = firstResultUrl(jobSet);
      if (!url) {
        throw new StudioError(
          "The drawing finished but I couldn't fetch it. Let's try again!",
          `completed job set had no result url: ${JSON.stringify(jobSet).slice(0, 300)}`,
          "higgsfield_no_result",
        );
      }
      return url;
    }
    if (status === "nsfw") {
      throw new StudioError(
        "That drawing didn't come out right. Let's try a different idea!",
        `job set ${jobSetId} was blocked by the content filter`,
        "higgsfield_nsfw",
      );
    }
    if (status === "failed") {
      throw new StudioError(
        "That drawing didn't work. Let's try again!",
        `job set ${jobSetId} failed: ${JSON.stringify(jobSet).slice(0, 300)}`,
        "higgsfield_failed",
      );
    }
    onProgress?.(status);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new StudioError(
    "That drawing is taking a really long time. Let's check again in a bit!",
    `polling timed out after ${POLL_TIMEOUT_MS}ms for job set ${jobSetId}`,
    "higgsfield_timeout",
  );
}
