/**
 * World Cards — the one-page design doc behind every world she makes.
 *
 * A card is written before Marble is ever called, kept in the repo next to the
 * world it produced, and used as the starting point whenever she wants to make
 * a bigger version of that world later.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./config.js";
import { slugify, readRegistry } from "./ledger.js";

export const DRAFTS_DIR = join(paths.worldsDir, "_drafts");
export const DIRECTIONS = ["front", "right", "back", "left"];

/** How the kind of game she wants shapes the space Marble builds. */
const GAME_SHAPE = {
  explore:
    "Lay the space out for exploring: winding paths, open clearings, and lots of " +
    "little nooks, alcoves and hiding spots tucked around the edges.",
  maze:
    "Lay the space out like a maze: narrow winding corridors between tall walls, " +
    "hedges or rock faces, with dead ends and turns.",
  platformer:
    "Build the space upward: strong vertical structure with stacked ledges, tiers, " +
    "boulders, rooftops and high places, so there is a route that climbs.",
  sandbox:
    "Leave a large flat open area in the middle with plenty of room, ringed by " +
    "scenery, so there is space to build things in it.",
};

export function loadStyles() {
  try {
    return JSON.parse(readFileSync(join(paths.root, "config", "styles.json"), "utf8")).styles || [];
  } catch {
    return [];
  }
}

/**
 * The Style Menu she picks from: the built-in styles, plus any world she has
 * already made, so her own worlds become styles for future ones.
 */
export function styleMenu() {
  const builtIn = loadStyles().map((s) => ({
    id: s.id, name: s.name, emoji: s.emoji, blurb: s.blurb, kind: "built-in", mood: s.mood,
  }));
  const hers = readRegistry().worlds.map((w) => ({
    id: `world:${w.id}`,
    name: w.name,
    emoji: "🌟",
    blurb: "One of your own worlds!",
    kind: "hers",
    mood: w.mood || "bright",
  }));
  return [...builtIn, ...hers];
}

/** Resolves a style id (built-in, or `world:<id>` for one of hers) to a recipe. */
export function resolveStyle(styleId) {
  if (!styleId) return null;
  if (styleId.startsWith("world:")) {
    const world = readRegistry().worlds.find((w) => w.id === styleId.slice(6));
    if (!world) return null;
    return {
      id: styleId,
      name: world.name,
      palette: [world.card?.answers?.colors || "the same colours as before"],
      lighting: world.card?.answers?.timeOfDay || "the same light as before",
      materials: world.card?.answers?.place || world.description || "",
      descriptors: ["exactly the same look and feel as that world"],
      mood: world.mood || "bright",
    };
  }
  return loadStyles().find((s) => s.id === styleId) || null;
}

/** Blends up to two styles — "candy + underwater" is a real thing she can ask for. */
export function mixStyles(styleIds = []) {
  const resolved = styleIds.map(resolveStyle).filter(Boolean).slice(0, 2);
  if (!resolved.length) return null;
  if (resolved.length === 1) return resolved[0];
  const [a, b] = resolved;
  return {
    id: `${a.id}+${b.id}`,
    name: `${a.name} + ${b.name}`,
    palette: [...a.palette.slice(0, 2), ...b.palette.slice(0, 2)],
    lighting: `${a.lighting}, blended with ${b.lighting}`,
    materials: `${a.materials}, mixed with ${b.materials}`,
    descriptors: [...a.descriptors.slice(0, 2), ...b.descriptors.slice(0, 2)],
    mood: a.mood,
  };
}

// ------------------------------------------------------------------ drafts

export function draftDir(draftId) {
  return join(DRAFTS_DIR, draftId);
}

export function newDraft({ name, answers, styleIds = [], gameType, directions = {}, parentWorldId = null }) {
  const base = slugify(name || answers.place || "world");
  let draftId = base;
  for (let i = 2; existsSync(draftDir(draftId)) && i < 500; i++) draftId = `${base}-${i}`;

  const draft = {
    draftId,
    name: name || answers.place || "My world",
    createdAtUtc: new Date().toISOString(),
    gameType: gameType || "explore",
    styleIds,
    answers,
    directions,
    parentWorldId,
    heroRevisions: 0,
    images: {},
    status: "designing",
  };
  mkdirSync(draftDir(draftId), { recursive: true });
  writeDraft(draft);
  return draft;
}

export function writeDraft(draft) {
  const dir = draftDir(draft.draftId);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, "draft.json.tmp");
  writeFileSync(tmp, `${JSON.stringify(draft, null, 2)}\n`);
  renameSync(tmp, join(dir, "draft.json"));
  return draft;
}

export function readDraft(draftId) {
  try {
    return JSON.parse(readFileSync(join(draftDir(draftId), "draft.json"), "utf8"));
  } catch {
    return null;
  }
}

export function listDrafts() {
  if (!existsSync(DRAFTS_DIR)) return [];
  return readdirSync(DRAFTS_DIR)
    .map((id) => readDraft(id))
    .filter(Boolean);
}

// ------------------------------------------------------- prompt + the card

/** Assembles the Marble prompt. She never sees this — it's backstage. */
export function assemblePrompt(draft) {
  const a = draft.answers || {};
  const style = mixStyles(draft.styleIds);
  const parts = [];

  parts.push(a.place ? `${a.place}.` : "A magical place.");
  if (style) {
    parts.push(
      `Built from ${style.materials}. Colours: ${style.palette.join(", ")}${a.colors ? `, and ${a.colors}` : ""}.`,
    );
    parts.push(`Lighting: ${style.lighting}.`);
  } else if (a.colors) {
    parts.push(`The colours everywhere are ${a.colors}.`);
  }
  if (a.timeOfDay) parts.push(`It is ${a.timeOfDay}.`);
  if (a.weather) parts.push(`The weather is ${a.weather}.`);
  if (a.inhabitants) parts.push(`It looks like the sort of place where ${a.inhabitants} live.`);
  if (a.secret) parts.push(`Hidden somewhere in it: ${a.secret}.`);

  const shape = GAME_SHAPE[draft.gameType];
  if (shape) parts.push(shape);

  const d = draft.directions || {};
  const bearings = DIRECTIONS.filter((k) => d[k]).map((k) => `${k}: ${d[k]}`);
  if (bearings.length) {
    parts.push(`Standing in the middle and turning around you see — ${bearings.join("; ")}.`);
  }
  if (style) parts.push(`Overall feel: ${style.descriptors.join(", ")}.`);

  return parts.join(" ");
}

/** The card she can have read back to her, and that grounds future expansions. */
export function renderWorldCard(draft) {
  const a = draft.answers || {};
  const style = mixStyles(draft.styleIds);
  const d = draft.directions || {};
  const row = (label, value) => `| **${label}** | ${String(value || "—").replace(/\|/g, "\\|")} |`;

  return [
    `# ${draft.name}`,
    "",
    draft.parentWorldId ? `*A bigger version of "${draft.parentWorldId}".*` : "*A brand-new world.*",
    "",
    "| | |",
    "| --- | --- |",
    row("What this place is", a.place),
    row("Who lives here", a.inhabitants),
    row("Colours everywhere", a.colors),
    row("Time of day", a.timeOfDay),
    row("Weather and mood", a.weather),
    row("The coolest secret", a.secret),
    row("What you hear", a.sounds),
    row("Style", style ? style.name : "her own idea"),
    row("Made for", `${draft.gameType} games`),
    "",
    "## Standing in the middle, turning around",
    "",
    `- **In front of me:** ${d.front || "—"}`,
    `- **On my right:** ${d.right || "—"}`,
    `- **Behind me:** ${d.back || "—"}`,
    `- **On my left:** ${d.left || "—"}`,
    "",
    "## Pictures",
    "",
    ...(draft.images.hero ? [`![hero](./hero.jpg)`, ""] : []),
    ...DIRECTIONS.filter((k) => draft.images[k]).map((k) => `- ${k}: \`${k}.jpg\``),
    "",
    "## The prompt that built it",
    "",
    "```",
    assemblePrompt(draft),
    "```",
    "",
    `*Designed ${new Date(draft.createdAtUtc).toISOString().slice(0, 10)} in the World Design Studio.*`,
    "",
  ].join("\n");
}

export function saveWorldCard(draft) {
  writeFileSync(join(draftDir(draft.draftId), "world-card.md"), renderWorldCard(draft));
}

/** Reads the card back as a short story, for her final yes. */
export function storyReadback(draft) {
  const a = draft.answers || {};
  const d = draft.directions || {};
  const bits = [
    `You're standing in ${a.place || "your world"}.`,
    a.timeOfDay ? `It's ${a.timeOfDay}.` : "",
    d.front ? `In front of you: ${d.front}.` : "",
    d.right ? `You turn right — ${d.right}.` : "",
    d.back ? `Behind you: ${d.back}.` : "",
    d.left ? `And on your left: ${d.left}.` : "",
    a.inhabitants ? `This is where ${a.inhabitants} live.` : "",
    a.sounds ? `You can hear ${a.sounds}.` : "",
    a.secret ? `And somewhere out there, hidden: ${a.secret}.` : "",
  ];
  return bits.filter(Boolean).join(" ");
}

/** Moves a finished draft into the real world folder once Marble has built it. */
export function promoteDraft(draftId, worldId) {
  const from = draftDir(draftId);
  const to = join(paths.worldsDir, worldId);
  mkdirSync(to, { recursive: true });
  for (const file of ["hero.jpg", "front.jpg", "right.jpg", "back.jpg", "left.jpg", "world-card.md"]) {
    const src = join(from, file);
    if (existsSync(src)) cpSync(src, join(to, file));
  }
  rmSync(from, { recursive: true, force: true });
  return to;
}
