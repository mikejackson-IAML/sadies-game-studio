/**
 * "Studio day" maths. The daily limit resets at midnight in the configured
 * timezone, so everything keys off a YYYY-MM-DD string computed in that zone
 * rather than off UTC.
 */

/** The calendar date in `timezone` for a given instant, as YYYY-MM-DD. */
export function studioDay(timezone, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Wall-clock time in `timezone` as {hour, minute, second}. */
export function wallClock(timezone, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Seconds until the next local midnight in `timezone`. */
export function secondsUntilReset(timezone, at = new Date()) {
  const { hour, minute, second } = wallClock(timezone, at);
  return 86400 - (hour * 3600 + minute * 60 + second);
}

/**
 * A countdown an 8-year-old can act on: "in about 3 hours", "tomorrow morning".
 * Deliberately fuzzy — precision here would be false precision across DST.
 */
export function friendlyReset(timezone, at = new Date()) {
  const secs = secondsUntilReset(timezone, at);
  const hours = secs / 3600;
  if (hours < 1) return `in less than an hour`;
  if (hours < 2) return `in about an hour`;
  if (hours < 10) return `in about ${Math.round(hours)} hours`;
  return `tomorrow morning`;
}
