import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_30_MIN_TIMES,
  COMMON_TIME_OPTIONS,
  formatActivityDuration,
  formatTime12Hour,
  isOvernightActivity,
  activityDurationMinutes,
  validateDailyActivities,
  createEmptyActivity,
  type DailyActivityEntry,
} from "../../src/lib/daily-activity";

test("quick-select time constants: contains 48 30-minute intervals and 8 common times", () => {
  assert.equal(ALL_30_MIN_TIMES.length, 48);
  assert.equal(ALL_30_MIN_TIMES[0], "00:00");
  assert.equal(ALL_30_MIN_TIMES[1], "00:30");
  assert.equal(ALL_30_MIN_TIMES[47], "23:30");

  assert.equal(COMMON_TIME_OPTIONS.length, 8);
  assert.deepEqual(COMMON_TIME_OPTIONS, [
    "06:00",
    "07:00",
    "08:00",
    "09:00",
    "12:00",
    "17:00",
    "18:00",
    "20:00",
  ]);
});

test("formatTime12Hour formats 24h times to human-readable 12h labels", () => {
  assert.equal(formatTime12Hour("00:00"), "12:00 AM");
  assert.equal(formatTime12Hour("00:30"), "12:30 AM");
  assert.equal(formatTime12Hour("06:00"), "6:00 AM");
  assert.equal(formatTime12Hour("09:30"), "9:30 AM");
  assert.equal(formatTime12Hour("12:00"), "12:00 PM");
  assert.equal(formatTime12Hour("12:30"), "12:30 PM");
  assert.equal(formatTime12Hour("17:00"), "5:00 PM");
  assert.equal(formatTime12Hour("20:00"), "8:00 PM");
  assert.equal(formatTime12Hour("23:30"), "11:30 PM");
});

test("isOvernightActivity accurately distinguishes daytime and overnight ranges", () => {
  assert.equal(isOvernightActivity("08:00", "09:00"), false);
  assert.equal(isOvernightActivity("09:00", "17:00"), false);
  assert.equal(isOvernightActivity("20:00", "06:00"), true);
  assert.equal(isOvernightActivity("23:30", "07:00"), true);
  assert.equal(isOvernightActivity("08:00", "08:00"), false);
  assert.equal(isOvernightActivity("", "08:00"), false);
});

test("calculates human-readable durations for quick-select examples", () => {
  const entry1: DailyActivityEntry = {
    ...createEmptyActivity(),
    startTime: "08:00",
    endTime: "09:00",
  };
  assert.equal(formatActivityDuration(activityDurationMinutes(entry1)), "1 hour");

  const entry2: DailyActivityEntry = {
    ...createEmptyActivity(),
    startTime: "17:00",
    endTime: "20:00",
  };
  assert.equal(formatActivityDuration(activityDurationMinutes(entry2)), "3 hours");

  const entry3: DailyActivityEntry = {
    ...createEmptyActivity(),
    startTime: "20:00",
    endTime: "06:00",
  };
  assert.equal(formatActivityDuration(activityDurationMinutes(entry3)), "10 hours");

  const entry4: DailyActivityEntry = {
    ...createEmptyActivity(),
    startTime: "08:00",
    endTime: "08:30",
  };
  assert.equal(formatActivityDuration(activityDurationMinutes(entry4)), "30 minutes");
});

test("rejects identical start and end time without treating as 24h", () => {
  const entry: DailyActivityEntry = {
    ...createEmptyActivity(),
    startTime: "08:00",
    endTime: "08:00",
    locationCategory: "Home",
    activityCategory: "Sleeping / Resting",
  };
  const result = validateDailyActivities([entry]);
  assert.ok(result.errors.some((e) => e.includes("identical")));
  assert.equal(activityDurationMinutes(entry), null);
});
