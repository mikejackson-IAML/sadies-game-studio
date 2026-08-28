#!/usr/bin/env node
/**
 * Runs at the start of every Claude Code session.
 *
 * Claude Code on the web clones this repo into a fresh container, so the MCP
 * server's one runtime dependency has to be installed before the world tools
 * work. She should never see this happen — it just needs to be true.
 */
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Her generated worlds are stored with Git LFS. Claude Code containers are
 * created fresh and do not ship git-lfs, so without this a session clones
 * pointer files instead of worlds and every game built on one breaks.
 *
 * Best effort throughout: the practice world is a plain blob precisely so the
 * four games still work if any of this fails.
 */
function ensureWorldFiles() {
  const hasLfs = () => {
    try {
      execFileSync("git", ["lfs", "version"], { cwd: ROOT, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };

  if (!hasLfs()) {
    for (const install of [
      ["apt-get", ["install", "-y", "-q", "git-lfs"]],
      ["brew", ["install", "git-lfs"]],
    ]) {
      try {
        execFileSync(install[0], install[1], { stdio: "ignore", timeout: 180_000 });
        if (hasLfs()) break;
      } catch {
        // Try the next package manager, then give up quietly.
      }
    }
  }
  if (!hasLfs()) {
    console.log(
      "STUDIO NOTE: git-lfs is unavailable, so worlds stored in LFS may not have downloaded. " +
        "The practice world and all four games still work. Tell her nothing technical.",
    );
    return;
  }

  try {
    execFileSync("git", ["lfs", "install", "--local"], { cwd: ROOT, stdio: "ignore" });
    execFileSync("git", ["lfs", "pull"], { cwd: ROOT, stdio: "ignore", timeout: 300_000 });
  } catch {
    // Offline or no LFS objects yet; her games still run.
  }
}

try {
  if (!existsSync(join(ROOT, "node_modules", "@modelcontextprotocol", "sdk"))) {
    execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], {
      cwd: ROOT,
      stdio: "ignore",
      timeout: 180_000,
    });
  }
  mkdirSync(join(ROOT, "logs"), { recursive: true });
  mkdirSync(join(ROOT, "games"), { recursive: true });
  ensureWorldFiles();

  if (!process.env.WORLDLABS_API_KEY && !existsSync(join(ROOT, ".env"))) {
    // Visible to Claude, never phrased for her. Claude turns this into
    // "ask your dad" if she tries to make a world.
    console.log(
      "STUDIO NOTE: WORLDLABS_API_KEY is not set, so make_world will not work. " +
        "Everything else (all four games, the practice world, shipping, the arcade) works fine. " +
        "If she asks for a world, tell her the magic key needs her dad — never show her an error.",
    );
  }
} catch (err) {
  console.log(`STUDIO NOTE: setup step failed (${String(err.message).split("\n")[0]}). Games still work.`);
}
