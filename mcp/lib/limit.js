import { studioDay, friendlyReset } from "./clock.js";
import { readUsage } from "./ledger.js";

/**
 * The daily cap. This is the enforcement point — CLAUDE.md and the skill also
 * describe the rule, but nothing downstream may generate a world without an
 * allowance from here.
 *
 * Counts both succeeded AND pending generations: a crashed run has already
 * spent credits, so it must still count against the day.
 */
export function checkAllowance(config, at = new Date()) {
  const day = studioDay(config.timezone, at);
  const usage = readUsage();
  const usedToday = usage.generations.filter(
    (g) => g.day === day && (g.status === "pending" || g.status === "succeeded"),
  ).length;

  const limit = config.dailyWorldLimit;
  const remaining = Math.max(0, limit - usedToday);

  return {
    day,
    limit,
    usedToday,
    remaining,
    allowed: remaining > 0,
    resetsIn: friendlyReset(config.timezone, at),
    timezone: config.timezone,
  };
}
