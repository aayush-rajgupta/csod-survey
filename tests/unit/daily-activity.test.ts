import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activityDurationMinutes,
  createEmptyActivity,
  minutesFromTime,
  toggleCheckboxSelection,
  validateDailyActivities,
  type DailyActivityEntry,
} from "../../src/lib/daily-activity";
import { validateCheckboxSelection } from "../../src/lib/survey-validation";

function activity(
  startTime: string,
  endTime: string,
  locationCategory = "Home",
  activityCategory = "Indoor work / Studying",
  locationOther = "",
  activityOther = "",
): DailyActivityEntry {
  return {
    ...createEmptyActivity(),
    startTime,
    endTime,
    locationCategory,
    locationOther,
    activityCategory,
    activityOther,
  };
}

test("calculates daytime and overnight durations", () => {
  assert.equal(activityDurationMinutes(activity("06:00", "08:00")), 120);
  assert.equal(activityDurationMinutes(activity("20:00", "06:00")), 600);
});

test("validates the complete 24-hour example without overlap", () => {
  const result = validateDailyActivities([
    activity("06:00", "08:00"),
    activity("08:00", "09:00", "Road / Commuting", "Commuting"),
    activity("09:00", "17:00", "Office / Workplace"),
    activity("17:00", "18:00", "Road / Commuting", "Commuting"),
    activity("18:00", "20:00", "Outdoor public space / Park", "Walking / Exercising"),
    activity("20:00", "06:00", "Home", "Sleeping / Resting"),
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalMinutes, 1440);
  assert.equal(result.unallocatedMinutes, 0);
});

test("allows adjacent schedule intervals (08:00–09:00 and 09:00–10:00)", () => {
  const result = validateDailyActivities([
    activity("08:00", "09:00"),
    activity("09:00", "10:00"),
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalMinutes, 120);
});

test("allows adjacent boundary at midnight (20:00–00:00 and 00:00–06:00)", () => {
  const result = validateDailyActivities([
    activity("20:00", "00:00"),
    activity("00:00", "06:00"),
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalMinutes, 600);
});

test("rejects identical start and end times", () => {
  const result = validateDailyActivities([activity("08:00", "08:00")]);
  assert.ok(result.errors.some((error) => error.includes("identical")));
});

test("rejects daytime overlaps", () => {
  const result = validateDailyActivities([
    activity("08:00", "09:30"),
    activity("09:00", "10:30"),
  ]);
  assert.ok(result.errors.some((error) => error.includes("overlap")));
});

test("rejects overnight overlaps with daytime blocks", () => {
  const result = validateDailyActivities([
    activity("20:00", "06:00"),
    activity("05:00", "07:00"),
  ]);
  assert.ok(result.errors.some((error) => error.includes("overlap")));
});

test("rejects multiple overlapping overnight blocks", () => {
  const result = validateDailyActivities([
    activity("20:00", "06:00"),
    activity("22:00", "05:00"),
  ]);
  assert.ok(result.errors.some((error) => error.includes("overlap")));
});

test("exact minute precision: accepts 06:00:00, rejects 06:00:00.1, 06:00:00.4, 06:00:01", () => {
  assert.equal(minutesFromTime("06:00:00"), 360, "06:00:00 must be accepted");
  assert.equal(minutesFromTime("06:00"), 360, "06:00 must be accepted");
  assert.equal(minutesFromTime("06:00:00.1"), null, "06:00:00.1 must be rejected");
  assert.equal(minutesFromTime("06:00:00.4"), null, "06:00:00.4 must be rejected");
  assert.equal(minutesFromTime("06:00:01"), null, "06:00:01 must be rejected");
  assert.equal(minutesFromTime("08:00:30"), null, "08:00:30 must be rejected");
});

test("preserves deterministic schedule ordering in JSON arrays", () => {
  const rawSchedule = [
    activity("06:00", "09:00", "Home", "Sleeping / Resting"),
    activity("09:00", "12:00", "Office / Workplace", "Indoor work / Studying"),
    activity("12:00", "13:00", "Market / Commercial area", "Shopping / Errands"),
    activity("13:00", "18:00", "Office / Workplace", "Indoor work / Studying"),
    activity("18:00", "20:00", "Road / Commuting", "Commuting"),
    activity("20:00", "06:00", "Home", "Sleeping / Resting"),
  ];

  // Simulating JSON array elements with ordinality (as in PostgreSQL jsonb_array_elements with ordinality)
  const orderedEntries = rawSchedule.map((entry, index) => ({
    sequence: index + 1,
    start_time: entry.startTime,
    end_time: entry.endTime,
    location_category: entry.locationCategory,
    activity_category: entry.activityCategory,
  }));

  assert.equal(orderedEntries[0].sequence, 1);
  assert.equal(orderedEntries[0].start_time, "06:00");
  assert.equal(orderedEntries[5].sequence, 6);
  assert.equal(orderedEntries[5].start_time, "20:00");

  // Re-sorting by sequence asc strictly preserves the participant's original order
  const retrieved = [...orderedEntries].sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(
    retrieved.map((r) => r.start_time),
    rawSchedule.map((s) => s.startTime),
  );
});

test("special checkbox choices are mutually exclusive", () => {
  assert.deepEqual(
    toggleCheckboxSelection(
      ["Vehicle exhaust", "Not sure"],
      "Road dust",
      true,
      ["I do not notice these sources", "Not sure"],
    ),
    ["Vehicle exhaust", "Road dust"],
  );
  assert.deepEqual(
    toggleCheckboxSelection(
      ["Vehicle exhaust", "Road dust"],
      "Not sure",
      true,
      ["I do not notice these sources", "Not sure"],
    ),
    ["Not sure"],
  );
});

test("checkbox validation accepts normal, special, and all listed choices", () => {
  const allowed = [
    "Vehicle exhaust",
    "Road dust",
    "Construction dust",
    "Industrial emissions",
    "Waste burning",
    "Diesel generators",
    "Household solid-fuel smoke",
    "Agricultural or seasonal burning",
    "I do not notice these sources",
    "Not sure",
  ];
  const options = {
    allowedValues: allowed,
    required: true,
    minItems: 1,
    maxItems: allowed.length,
    mutuallyExclusive: ["I do not notice these sources", "Not sure"],
  };

  assert.equal(validateCheckboxSelection({ ...options, selected: [] }), "Select at least one option.");
  assert.equal(validateCheckboxSelection({ ...options, selected: ["Vehicle exhaust"] }), null);
  // All 8 normal choices selected together
  assert.equal(validateCheckboxSelection({ ...options, selected: allowed.slice(0, 8) }), null);
  // Special choices selected alone
  assert.equal(validateCheckboxSelection({ ...options, selected: ["I do not notice these sources"] }), null);
  assert.equal(validateCheckboxSelection({ ...options, selected: ["Not sure"] }), null);
  // Combining special option with normal options must be rejected
  assert.equal(
    validateCheckboxSelection({ ...options, selected: ["Vehicle exhaust", "Not sure"] }),
    "Choose either a single special option or normal options.",
  );
});
