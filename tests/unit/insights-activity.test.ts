import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDailyActivityInsights,
  emptyDailyActivity,
  CATEGORY_SUPPRESSION_THRESHOLD,
} from "../../src/lib/insights-data";

test("emptyDailyActivity returns zeroed coverage and suppressed breakdown", () => {
  assert.equal(CATEGORY_SUPPRESSION_THRESHOLD, 5);
  const empty = emptyDailyActivity();
  assert.equal(empty.coverage.scheduleCount, 0);
  assert.equal(empty.coverage.totalRecordedHours, 0);
  assert.equal(empty.coverage.averageRecordedHours, 0);
  assert.equal(empty.coverage.averageUnallocatedHours, 24);
  assert.equal(empty.isSuppressed, true);
  assert.equal(empty.activities.length, 8);
  assert.equal(empty.locations.length, 8);
});

test("aggregates daily activities and locations across eligible submissions", () => {
  // 5 submissions (reaching suppression threshold)
  const targetIds = new Set(["sub-1", "sub-2", "sub-3", "sub-4", "sub-5"]);

  const sampleRows = [
    // sub-1: Sleeping (480 min = 8h), Office (480 min = 8h), Commuting (120 min = 2h) -> 18h total, 6h unallocated
    {
      submission_id: "sub-1",
      sequence: 1,
      start_time: "22:00",
      end_time: "06:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-1",
      sequence: 2,
      start_time: "08:00",
      end_time: "09:00",
      location_category: "Road / Commuting",
      activity_category: "Commuting",
      duration_minutes: 60,
    },
    {
      submission_id: "sub-1",
      sequence: 3,
      start_time: "09:00",
      end_time: "17:00",
      location_category: "Office / Workplace",
      activity_category: "Indoor work / Studying",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-1",
      sequence: 4,
      start_time: "17:00",
      end_time: "18:00",
      location_category: "Road / Commuting",
      activity_category: "Commuting",
      duration_minutes: 60,
    },

    // sub-2: Sleeping (480 min), Office (480 min)
    {
      submission_id: "sub-2",
      sequence: 1,
      start_time: "23:00",
      end_time: "07:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-2",
      sequence: 2,
      start_time: "09:00",
      end_time: "17:00",
      location_category: "Office / Workplace",
      activity_category: "Indoor work / Studying",
      duration_minutes: 480,
    },

    // sub-3: Sleeping (480 min), Commuting (60 min)
    {
      submission_id: "sub-3",
      sequence: 1,
      start_time: "23:00",
      end_time: "07:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-3",
      sequence: 2,
      start_time: "08:00",
      end_time: "09:00",
      location_category: "Road / Commuting",
      activity_category: "Commuting",
      duration_minutes: 60,
    },

    // sub-4: Sleeping (480 min)
    {
      submission_id: "sub-4",
      sequence: 1,
      start_time: "22:00",
      end_time: "06:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },

    // sub-5: Sleeping (480 min), Outdoor work (300 min)
    {
      submission_id: "sub-5",
      sequence: 1,
      start_time: "22:00",
      end_time: "06:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-5",
      sequence: 2,
      start_time: "08:00",
      end_time: "13:00",
      location_category: "Industrial / Construction area",
      activity_category: "Outdoor work",
      duration_minutes: 300,
    },

    // An ineligible submission that should be excluded
    {
      submission_id: "sub-excluded",
      sequence: 1,
      start_time: "10:00",
      end_time: "12:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 120,
    },
  ];

  const result = buildDailyActivityInsights(sampleRows, targetIds);

  // Coverage
  assert.equal(result.coverage.scheduleCount, 5);
  assert.equal(result.isSuppressed, false);

  // Total recorded minutes:
  // sub-1: 480 + 60 + 480 + 60 = 1080 (18h)
  // sub-2: 480 + 480 = 960 (16h)
  // sub-3: 480 + 60 = 540 (9h)
  // sub-4: 480 (8h)
  // sub-5: 480 + 300 = 780 (13h)
  // Total: 3840 min = 64.0 hours
  assert.equal(result.coverage.totalRecordedHours, 64);
  // Average recorded hours: 64 / 5 = 12.8 hours
  assert.equal(result.coverage.averageRecordedHours, 12.8);
  // Average unallocated hours:
  // Unallocated per sub: 6 + 8 + 15 + 16 + 11 = 56 hours total. 56 / 5 = 11.2 hours.
  assert.equal(result.coverage.averageUnallocatedHours, 11.2);

  // Check activity: Sleeping / Resting
  // All 5 participants reported sleeping 480 min each (total 2400 min = 40h)
  // Average = 8.0 hours
  const sleepActivity = result.activities.find((a) => a.category === "Sleeping / Resting");
  assert.ok(sleepActivity);
  assert.equal(sleepActivity.respondentCount, 5);
  assert.equal(sleepActivity.respondentPercentage, 100);
  assert.equal(sleepActivity.averageHours, 8.0);

  // Check activity: Commuting
  // sub-1 (120 min) and sub-3 (60 min) = 180 min total across 5 participants = 36 min avg = 0.6 hours
  const commuteActivity = result.activities.find((a) => a.category === "Commuting");
  assert.ok(commuteActivity);
  assert.equal(commuteActivity.respondentCount, 2);
  assert.equal(commuteActivity.respondentPercentage, 40);
  assert.equal(commuteActivity.totalMinutes, 180);
  assert.equal(commuteActivity.averageHours, 0.6);

  // Check location: Home
  // All 5 reported Home (480 min each = 2400 min)
  const homeLoc = result.locations.find((l) => l.category === "Home");
  assert.ok(homeLoc);
  assert.equal(homeLoc.respondentCount, 5);
  assert.equal(homeLoc.averageHours, 8.0);
});

test("suppresses breakdowns when distinct schedules are fewer than threshold", () => {
  const targetIds = new Set(["sub-1", "sub-2"]);
  const sampleRows = [
    {
      submission_id: "sub-1",
      sequence: 1,
      start_time: "22:00",
      end_time: "06:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
    {
      submission_id: "sub-2",
      sequence: 1,
      start_time: "22:00",
      end_time: "06:00",
      location_category: "Home",
      activity_category: "Sleeping / Resting",
      duration_minutes: 480,
    },
  ];

  const result = buildDailyActivityInsights(sampleRows, targetIds);
  assert.equal(result.coverage.scheduleCount, 2);
  assert.equal(result.isSuppressed, true, "Must be suppressed when count < 5");
});
