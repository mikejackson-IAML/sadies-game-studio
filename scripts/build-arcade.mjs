#!/usr/bin/env node
/**
 * Builds docs/index.html — her arcade. This is the page she sends to family,
 * so it is written for her and her grandparents, not for developers.
 *
 * Reads docs/arcade.json (the list of shipped games) and config/studio.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCADE_JSON = join(ROOT, "docs", "arcade.json");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function readArcade() {
  try {
    const data = JSON.parse(readFileSync(ARCADE_JSON, "utf8"));
    return Array.isArray(data.games) ? data : { version: 1, games: [] };
  } catch {
    return { version: 1, games: [] };
  }
}

export function writeArcade(data) {
  mkdirSync(dirname(ARCADE_JSON), { recursive: true });
  writeFileSync(ARCADE_JSON, `${JSON.stringify(data, null, 2)}\n`);
}

const CARD_COLORS = [
  ["#ff6ba9", "#ffc93c"], ["#4fb8ff", "#8a63d2"], ["#3ddc97", "#4fb8ff"],
  ["#ffc93c", "#ff8c42"], ["#8a63d2", "#ff6ba9"], ["#3ddc97", "#ffc93c"],
];

/** A game with no cover picture still gets a bright card, never a broken image. */
function fallbackCover(title, index) {
  const [a, b] = CARD_COLORS[index % CARD_COLORS.length];
  const initials = String(title).split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="320" height="200" fill="url(#g)"/>` +
    `<text x="160" y="118" font-family="system-ui,sans-serif" font-size="72" font-weight="800" ` +
    `fill="#fffdf7" text-anchor="middle">${esc(initials)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function buildArcade() {
  const arcade = readArcade();
  let studioName = "";
  try {
    studioName = JSON.parse(readFileSync(join(ROOT, "config", "studio.json"), "utf8")).studioName || "";
  } catch {
    studioName = "";
  }
  const heading = studioName || "My Game Studio";

  const cards = arcade.games.map((game, i) => {
    const cover = game.cover ? `./${game.cover}` : fallbackCover(game.title, i);
    const made = game.shippedAt
      ? new Date(game.shippedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "";
    return `        <a class="card" href="./games/${esc(game.slug)}/">
          <img class="cover" src="${esc(cover)}" alt="" />
          <div class="card-body">
            <h2>${esc(game.title)}</h2>
            <p class="world">${esc(game.worldName || "")}</p>
            <p class="made">${esc(made)}</p>
            <span class="play">PLAY ▸</span>
          </div>
        </a>`;
  }).join("\n");

  const empty = `        <div class="empty">
          <div class="empty-emoji">🎮</div>
          <h2>No games here yet!</h2>
          <p>The first game you ship will show up right here.</p>
        </div>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(heading)}</title>
    <meta name="description" content="Games made by a kid, with 3D worlds she dreamed up herself." />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%8E%AE%3C/text%3E%3C/svg%3E" />
    <style>
      :root {
        --ink: #23214a; --paper: #fffdf7; --sunshine: #ffc93c;
        --bubblegum: #ff6ba9; --grape: #8a63d2; --mint: #3ddc97;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; min-height: 100%; color: var(--ink);
        font-family: "Baloo 2", "Comic Sans MS", "Trebuchet MS", system-ui, sans-serif;
        background: linear-gradient(160deg, #ffe6f2 0%, #e3f0ff 45%, #e8fff4 100%);
        background-attachment: fixed;
      }
      header { text-align: center; padding: 46px 20px 10px; }
      h1 {
        margin: 0; font-size: clamp(36px, 9vw, 76px); font-weight: 800; line-height: 1.05;
        color: var(--ink); text-shadow: 4px 4px 0 var(--sunshine);
      }
      .tagline { font-size: clamp(15px, 3.6vw, 20px); font-weight: 700; color: #5a5680; margin: 14px 0 0; }
      main { max-width: 1080px; margin: 0 auto; padding: 30px 20px 70px; }
      .grid { display: grid; gap: 22px; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); }
      .card {
        display: block; text-decoration: none; color: inherit; background: var(--paper);
        border: 5px solid var(--ink); border-radius: 26px; overflow: hidden;
        box-shadow: 0 8px 0 rgba(35, 33, 74, 0.22); transition: transform 0.12s ease, box-shadow 0.12s ease;
      }
      .card:hover, .card:focus-visible { transform: translateY(-6px); box-shadow: 0 14px 0 rgba(35, 33, 74, 0.22); }
      .cover { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; background: var(--grape); }
      .card-body { padding: 16px 18px 20px; }
      .card-body h2 { margin: 0 0 6px; font-size: 25px; }
      .world { margin: 0; font-size: 15px; font-weight: 700; color: var(--grape); }
      .made { margin: 4px 0 14px; font-size: 13px; color: #7b7799; }
      .play {
        display: inline-block; background: var(--mint); border: 4px solid var(--ink);
        border-radius: 16px; padding: 7px 18px; font-weight: 800; font-size: 17px;
      }
      .empty {
        grid-column: 1 / -1; text-align: center; background: var(--paper);
        border: 5px dashed var(--ink); border-radius: 26px; padding: 54px 24px;
      }
      .empty-emoji { font-size: 68px; }
      .empty h2 { margin: 8px 0; }
      footer { text-align: center; padding: 0 20px 46px; font-size: 14px; color: #7b7799; }
    </style>
  </head>
  <body>
    <header>
      <h1>${esc(heading)}</h1>
      <p class="tagline">Games I made, in worlds I dreamed up. Pick one and play! 🎮</p>
    </header>
    <main>
      <div class="grid">
${arcade.games.length ? cards : empty}
      </div>
    </main>
    <footer>Made with Claude · The 3D worlds were dreamed up by me and built with Marble.</footer>
  </body>
</html>
`;

  mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(join(ROOT, "docs", "index.html"), html);
  if (!existsSync(ARCADE_JSON)) writeArcade(arcade);
  // GitHub Pages runs Jekyll by default, which skips files starting with "_".
  writeFileSync(join(ROOT, "docs", ".nojekyll"), "");
  return arcade.games.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = buildArcade();
  console.log(`Arcade rebuilt with ${count} game${count === 1 ? "" : "s"} -> docs/index.html`);
}
