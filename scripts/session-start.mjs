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
