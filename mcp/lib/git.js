import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT, redact } from "./config.js";

const run = promisify(execFile);

async function git(args, { timeout = 30000 } = {}) {
  const { stdout } = await run("git", args, { cwd: ROOT, timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Commit (and try to push) the usage ledger the moment a world is generated.
 *
 * This is what makes the daily limit hold. Claude Code web sessions run in
 * ephemeral containers that re-clone the repo, so a ledger that only exists on
 * local disk would reset every session and hand out unlimited generations.
 * Pushing makes the remote authoritative.
 *
 * Never throws — a git problem must not lose her world.
 */
export async function persistLedger(message, files) {
  const result = { committed: false, pushed: false, note: "" };
  try {
    await git(["add", "--", ...files]);
    const staged = await git(["diff", "--cached", "--name-only"]);
    if (!staged) {
      result.note = "nothing to commit";
      return result;
    }
    await git(["commit", "-m", message]);
    result.committed = true;
  } catch (err) {
    result.note = redact(err.stderr || err.message);
    return result;
  }

  try {
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    await git(["push", "origin", branch], { timeout: 60000 });
    result.pushed = true;
  } catch (err) {
    // Offline or no remote yet. The limit still holds for this session; it just
    // is not durable across a fresh container until someone pushes.
    result.note = redact(err.stderr || err.message);
  }
  return result;
}
