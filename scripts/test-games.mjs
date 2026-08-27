#!/usr/bin/env node
/**
 * Proves each game template actually runs in a real browser against the
 * placeholder world: the splat loads, WebGL renders real pixels, the controls
 * move the player, and nothing errors in the console.
 *
 *   npm run test:games
 */
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { existsSync } from "node:fs";
import { decodePng, colorVariety } from "./lib/png.mjs";

const PORT = 8137;
const GAMES = [
  { dir: "explore", title: "Explore and Collect" },
  { dir: "maze", title: "Maze Adventure" },
  { dir: "platformer", title: "Jump and Climb" },
  { dir: "sandbox", title: "Build Anything" },
];

const server = await startServer(PORT);

// Prefer a chromium already present on the machine (CI images often ship one)
// before falling back to whatever Playwright downloaded.
const preinstalled = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  executablePath: existsSync(preinstalled) ? preinstalled : undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

let failures = 0;

for (const game of GAMES) {
  const context = await browser.newContext({ viewport: { width: 900, height: 640 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));

  const problems = [];
  try {
    await page.goto(`http://localhost:${PORT}/templates/${game.dir}/`, { waitUntil: "load" });

    // The loading overlay only hides once the splat world has fully parsed.
    await page.waitForSelector(".overlay.loading[hidden]", { state: "attached", timeout: 90_000 });

    const splats = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
      return { hasCanvas: !!canvas, hasGL: !!gl, width: canvas?.width ?? 0 };
    });
    if (!splats.hasCanvas) problems.push("no canvas");
    if (!splats.hasGL) problems.push("no WebGL context");
    if (splats.width === 0) problems.push("canvas has zero width");

    // The overlays must be genuinely gone, not merely marked hidden: a stray
    // `display` rule can keep them painted over the game.
    const overlays = await page.evaluate(() => {
      const visible = (sel) => {
        const node = document.querySelector(sel);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && node.getBoundingClientRect().width > 0;
      };
      return { loading: visible(".overlay.loading"), win: visible(".overlay.win") };
    });
    if (overlays.loading) problems.push("loading overlay is still covering the game");
    if (overlays.win) problems.push("win overlay is showing before the game is won");

    // Confirm real geometry is on screen rather than a flat background colour.
    // Read it from a real screenshot: the WebGL drawing buffer is cleared after
    // each frame, so sampling the canvas directly always looks blank.
    const shot = await page.screenshot({ type: "png" });
    const variety = colorVariety(decodePng(shot));
    if (variety < 8) problems.push(`frame looks empty (only ${variety} distinct colours)`);

    // Walking forward must actually change the player position. Poll rather
    // than time a fixed window: this headless browser renders in software at a
    // few frames a second, so a wall-clock budget would measure the frame rate
    // rather than whether the controls work.
    const before = await page.evaluate(() => window.__studioPos?.());
    await page.keyboard.down("ArrowUp");
    let moved = 0;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(250);
      const now = await page.evaluate(() => window.__studioPos?.());
      if (!before || !now) break;
      moved = Math.hypot(now.x - before.x, now.z - before.z);
      if (moved >= 1) break;
    }
    await page.keyboard.up("ArrowUp");
    if (!before) problems.push("could not read player position");
    else if (moved < 1) problems.push(`player barely moved (${moved.toFixed(2)}m in 15s)`);

    // Her character must actually be in the scene, and sound must have loaded.
    const debug = await page.evaluate(() => window.__studioDebug?.());
    if (!debug?.hasAvatar) problems.push("her avatar is not in the scene");
    if (!debug?.audioReady) problems.push("audio failed to load");

    if (errors.length) problems.push(`console errors: ${errors.slice(0, 3).join(" | ")}`);
  } catch (err) {
    problems.push(String(err).split("\n")[0]);
  }

  if (problems.length) {
    failures++;
    console.log(`FAIL  ${game.title}`);
    for (const p of problems) console.log(`        - ${p}`);
  } else {
    console.log(`PASS  ${game.title}`);
  }
  await context.close();
}

await browser.close();
server.close();

console.log(failures ? `\n${failures} of ${GAMES.length} games failed.` : `\nAll ${GAMES.length} games run.`);
process.exit(failures ? 1 : 0);
