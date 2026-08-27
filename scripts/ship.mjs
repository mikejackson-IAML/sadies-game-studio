#!/usr/bin/env node
/**
 * /ship — build a game, publish it to GitHub Pages, add it to the arcade.
 *
 *   npm run ship -- --game explore --title "Fox Forest Adventure"
 *   npm run ship -- --game my-maze --title "Spooky Maze" --world candy-forest
 *
 * Publishing target is docs/ on the default branch (GitHub Pages "main /docs").
 * Shipped games are never overwritten by a different game: re-shipping the same
 * title updates it in place, a new title gets a new slot.
 *
 * Nothing publishes until the privacy check passes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readArcade, writeArcade, buildArcade } from "./build-arcade.mjs";
import { runPrivacyCheck } from "./privacy-check.mjs";
import { stripJpegMetadata } from "./lib/jpeg.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const slugify = (t) =>
  String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "game";

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------- resolve game
const gameArg = arg("game");
const title = arg("title");
if (!gameArg) fail('Which game? Try: npm run ship -- --game explore --title "My Game"');
if (!title) fail('Give it a title: npm run ship -- --game explore --title "My Game"');

const config = readJson(join(ROOT, "config", "studio.json"), {});
const gameName = basename(gameArg);
let sourceDir = join(ROOT, "games", gameName);

if (!existsSync(sourceDir)) {
  // She asked to ship a template directly — copy it into games/ first so the
  // pristine template is never modified.
  const template = join(ROOT, "templates", gameName);
  if (!existsSync(template)) fail(`I can't find a game called "${gameName}".`);
  mkdirSync(dirname(sourceDir), { recursive: true });
  cpSync(template, sourceDir, { recursive: true });
  console.log(`Copied template "${gameName}" into games/${gameName}/ so the template stays clean.`);
}

const gameConfig = readJson(join(sourceDir, "game-config.json"), {});
const worldId = arg("world", gameConfig.worldId || "placeholder");
const worldDir = join(ROOT, "worlds", worldId);
if (!existsSync(worldDir)) fail(`I can't find a world called "${worldId}".`);

const worldFile = existsSync(join(worldDir, "world.spz"))
  ? "world.spz"
  : gameConfig.worldFile || "world.ply";
if (!existsSync(join(worldDir, worldFile))) fail(`World "${worldId}" has no world file in it.`);

// The music bed follows the world's style.
const registry = readJson(join(ROOT, "worlds", "worlds.json"), { worlds: [] });
const worldRecord = registry.worlds.find((w) => w.id === worldId);
const styles = readJson(join(ROOT, "config", "styles.json"), { styles: [] });
const worldName = worldRecord?.name || (worldId === "placeholder" ? "Practice World" : worldId);
const mood =
  worldRecord?.mood ||
  styles.styles.find((s) => s.id === worldRecord?.styleId)?.mood ||
  "bright";

// ------------------------------------------------------------------ build out
const slug = slugify(title);
const outDir = join(ROOT, "docs", "games", slug);
const arcade = readArcade();
const wasAlreadyShipped = arcade.games.some((g) => g.slug === slug);

// Rebuild this game's folder from scratch so removed files don't linger, but
// never touch any other shipped game.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(sourceDir, outDir, { recursive: true });

// Shared runtime, copied at the same relative depth the templates expect
// (docs/games/<slug>/../../shared === docs/shared).
cpSync(join(ROOT, "shared"), join(ROOT, "docs", "shared"), { recursive: true });
cpSync(join(ROOT, "vendor"), join(ROOT, "docs", "vendor"), { recursive: true });
cpSync(join(ROOT, "assets"), join(ROOT, "docs", "assets"), { recursive: true });
mkdirSync(join(ROOT, "docs", "worlds", worldId), { recursive: true });
cpSync(join(worldDir, worldFile), join(ROOT, "docs", "worlds", worldId, worldFile));

// Only the avatar goes public — never the whole config directory.
mkdirSync(join(ROOT, "docs", "config"), { recursive: true });
const avatar = readJson(join(ROOT, "config", "avatar.json"), {});
delete avatar._comments;
writeFileSync(join(ROOT, "docs", "config", "avatar.json"), `${JSON.stringify(avatar, null, 2)}\n`);

writeFileSync(
  join(outDir, "game-config.json"),
  `${JSON.stringify({ worldId, worldFile, worldName, mood, studioName: config.studioName || "" }, null, 2)}\n`,
);

// ----------------------------------------------------------------- cover image
let cover = null;
const explicitCover = arg("cover");
const candidates = [
  explicitCover ? join(ROOT, explicitCover) : null,
  join(worldDir, "hero.jpg"), // the World Card's hero concept image
  join(worldDir, "thumb.jpg"),
].filter((p) => p && existsSync(p));

if (candidates.length) {
  // Strip EXIF on the way in: a camera photo can carry GPS and device details.
  writeFileSync(join(outDir, "cover.jpg"), stripJpegMetadata(readFileSync(candidates[0])));
  cover = `games/${slug}/cover.jpg`;
}

// -------------------------------------------------------------------- arcade
const existing = arcade.games.find((g) => g.slug === slug);
const entry = {
  slug,
  title,
  game: gameName,
  worldId,
  worldName,
  mood,
  cover,
  shippedAt: existing?.shippedAt || new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
if (existing) Object.assign(existing, entry);
else arcade.games.unshift(entry);
writeArcade(arcade);
buildArcade();

console.log(`Built "${title}" -> docs/games/${slug}/`);

// ------------------------------------------------------------ privacy gate
const violations = runPrivacyCheck();
if (violations.length) {
  // Roll the publish back entirely rather than leaving anything staged.
  rmSync(outDir, { recursive: true, force: true });
  if (!wasAlreadyShipped) {
    const rolled = readArcade();
    rolled.games = rolled.games.filter((g) => g.slug !== slug);
    writeArcade(rolled);
  }
  buildArcade();
  console.error("\n  PRIVACY CHECK FAILED — nothing was published and the build was rolled back:\n");
  for (const v of violations) console.error(`    - ${v}`);
  console.error("\n  Fix the content, then ship again.\n");
  process.exit(1);
}

// -------------------------------------------------------------------- publish
if (config.requireShipApproval === true && !has("approve")) {
  console.log(
    [
      "",
      "  STAGED, NOT PUBLISHED.",
      "  requireShipApproval is true in config/studio.json, so this game is built",
      "  but not pushed. Review it, then publish with:",
      "",
      `    npm run ship -- --game ${gameName} --title ${JSON.stringify(title)} --approve`,
      "",
      "  (Or set requireShipApproval to false to publish immediately every time.)",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
try {
  git(["add", "--", "docs", "games", "config/studio.json"]);
  if (git(["diff", "--cached", "--name-only"]).trim()) {
    git(["commit", "-m", `Ship "${title}" to the arcade`]);
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  git(["push", "origin", branch]);

  let url = `https://<your-github-username>.github.io/her-game-studio/games/${slug}/`;
  try {
    const remote = git(["remote", "get-url", "origin"]).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) url = `https://${match[1].toLowerCase()}.github.io/${match[2]}/games/${slug}/`;
  } catch {
    // No remote configured yet; the placeholder URL still shows the shape.
  }
  console.log(`\n  LIVE: ${url}\n  Arcade: ${url.replace(`games/${slug}/`, "")}\n`);
} catch (err) {
  console.error(
    "\n  Built and saved locally, but publishing failed:\n  " +
      String(err.message).split("\n")[0] +
      "\n  Check the remote and GitHub Pages settings, then re-run.\n",
  );
  process.exit(1);
}
