import test from "node:test";
import assert from "node:assert/strict";
import { studioDay, secondsUntilReset, friendlyReset } from "../lib/clock.js";

const TZ = "America/Chicago";

test("studio day is the local date, not the UTC date", () => {
  // 05:30 UTC on 1 March is still 23:30 on 28 February in Chicago.
  const instant = new Date("2026-03-01T05:30:00Z");
  assert.equal(studioDay(TZ, instant), "2026-02-28");
  assert.equal(studioDay("UTC", instant), "2026-03-01");
});

test("the day rolls over at local midnight", () => {
  assert.equal(studioDay(TZ, new Date("2026-03-01T05:59:00Z")), "2026-02-28");
  assert.equal(studioDay(TZ, new Date("2026-03-01T06:01:00Z")), "2026-03-01");
});

test("daylight saving does not shift the studio day", () => {
  // 2026-03-08 is the US spring-forward date; Chicago goes UTC-6 to UTC-5.
  assert.equal(studioDay(TZ, new Date("2026-03-08T06:30:00Z")), "2026-03-08");
  assert.equal(studioDay(TZ, new Date("2026-07-04T04:30:00Z")), "2026-07-03");
});

test("seconds until reset shrink as local midnight approaches", () => {
  const early = secondsUntilReset(TZ, new Date("2026-06-15T13:00:00Z")); // 08:00 local
  const late = secondsUntilReset(TZ, new Date("2026-06-16T04:00:00Z")); // 23:00 local
  assert.ok(early > late);
  assert.ok(late > 0 && late <= 3600);
});

test("the countdown she reads is fuzzy and friendly", () => {
  assert.equal(friendlyReset(TZ, new Date("2026-06-16T04:30:00Z")), "in less than an hour");
  assert.equal(friendlyReset(TZ, new Date("2026-06-15T13:00:00Z")), "tomorrow morning");
});
