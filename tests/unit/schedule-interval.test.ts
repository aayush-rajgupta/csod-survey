import assert from "node:assert/strict";
import { test } from "node:test";

import { minutesFromTime } from "../../src/lib/daily-activity";

interface Interval {
  start: number; // minute of day (0..1439)
  end: number;   // minute of day (0..1439)
}

function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length !== 2) throw new Error("Time must be in HH:MM format (no seconds)");
  const [h, m] = parts.map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error("Invalid time values");
  }
  return h * 60 + m;
}

function computeDurationMinutes(startStr: string, endStr: string): number {
  const start = parseTimeToMinutes(startStr);
  const end = parseTimeToMinutes(endStr);
  if (start === end) throw new Error("Start and end times cannot be identical");
  return end > start ? end - start : 1440 - start + end;
}

/**
 * Pure simulation of the SQL validate_daily_activity_entry() closed-form logic.
 */
function checkIntervalOverlap(a: Interval, b: Interval): boolean {
  if (a.start === a.end || b.start === b.end) {
    throw new Error("Start and end times cannot be identical");
  }

  const aWraps = a.end < a.start;
  const bWraps = b.end < b.start;

  if (!aWraps && !bWraps) {
    // Both daytime: [sA, eA) vs [sB, eB)
    return a.start < b.end && b.start < a.end;
  }
  if (aWraps && !bWraps) {
    // a wraps: [sA, 1440) U [0, eA) vs [sB, eB)
    return a.start < b.end || b.start < a.end;
  }
  if (!aWraps && bWraps) {
    // b wraps: [sA, eA) vs [sB, 1440) U [0, eB)
    return b.start < a.end || a.start < b.end;
  }
  // Both wrap midnight: unconditionally overlap
  return true;
}

test("verifies exact overnight duration calculation (20:00–06:00 = 600 minutes)", () => {
  assert.equal(computeDurationMinutes("20:00", "06:00"), 600);
  assert.equal(computeDurationMinutes("22:00", "07:30"), 570);
  assert.equal(computeDurationMinutes("06:00", "08:00"), 120);
});

test("verifies complete 24-hour schedule totaling exactly 1440 minutes without overlap", () => {
  const schedule = [
    { start: "06:00", end: "08:00" }, // 120 min
    { start: "08:00", end: "09:00" }, // 60 min
    { start: "09:00", end: "17:00" }, // 480 min
    { start: "17:00", end: "18:00" }, // 60 min
    { start: "18:00", end: "20:00" }, // 120 min
    { start: "20:00", end: "06:00" }, // 600 min (overnight)
  ];

  const intervals = schedule.map((s) => ({
    start: parseTimeToMinutes(s.start),
    end: parseTimeToMinutes(s.end),
  }));

  let totalDuration = 0;
  for (let i = 0; i < schedule.length; i++) {
    totalDuration += computeDurationMinutes(schedule[i].start, schedule[i].end);
    for (let j = i + 1; j < schedule.length; j++) {
      assert.equal(
        checkIntervalOverlap(intervals[i], intervals[j]),
        false,
        `Intervals ${i} (${schedule[i].start}-${schedule[i].end}) and ${j} (${schedule[j].start}-${schedule[j].end}) must not overlap`,
      );
    }
  }

  assert.equal(totalDuration, 1440);
});

test("adjacent intervals do not overlap", () => {
  const a = { start: parseTimeToMinutes("08:00"), end: parseTimeToMinutes("09:00") };
  const b = { start: parseTimeToMinutes("09:00"), end: parseTimeToMinutes("10:00") };
  assert.equal(checkIntervalOverlap(a, b), false);
  assert.equal(checkIntervalOverlap(b, a), false);
});

test("daytime overlapping intervals are detected", () => {
  const a = { start: parseTimeToMinutes("08:00"), end: parseTimeToMinutes("09:30") };
  const b = { start: parseTimeToMinutes("09:00"), end: parseTimeToMinutes("10:00") };
  assert.equal(checkIntervalOverlap(a, b), true);
  assert.equal(checkIntervalOverlap(b, a), true);
});

test("overnight interval with adjacent daytime intervals does not overlap", () => {
  const overnight = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("06:00") };
  const morning = { start: parseTimeToMinutes("06:00"), end: parseTimeToMinutes("08:00") };
  const evening = { start: parseTimeToMinutes("18:00"), end: parseTimeToMinutes("20:00") };

  // Adjacent at 06:00
  assert.equal(checkIntervalOverlap(overnight, morning), false);
  assert.equal(checkIntervalOverlap(morning, overnight), false);

  // Adjacent at 20:00
  assert.equal(checkIntervalOverlap(overnight, evening), false);
  assert.equal(checkIntervalOverlap(evening, overnight), false);
});

test("overnight interval overlapping morning daytime interval is detected", () => {
  const overnight = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("06:00") };
  const morningOverlap = { start: parseTimeToMinutes("05:00"), end: parseTimeToMinutes("07:00") };
  assert.equal(checkIntervalOverlap(overnight, morningOverlap), true);
  assert.equal(checkIntervalOverlap(morningOverlap, overnight), true);
});

test("overnight interval overlapping evening daytime interval is detected", () => {
  const overnight = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("06:00") };
  const eveningOverlap = { start: parseTimeToMinutes("19:00"), end: parseTimeToMinutes("21:00") };
  assert.equal(checkIntervalOverlap(overnight, eveningOverlap), true);
  assert.equal(checkIntervalOverlap(eveningOverlap, overnight), true);
});

test("two overnight intervals wrapping midnight always overlap", () => {
  const night1 = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("06:00") };
  const night2 = { start: parseTimeToMinutes("22:00"), end: parseTimeToMinutes("05:00") };
  assert.equal(checkIntervalOverlap(night1, night2), true);
  assert.equal(checkIntervalOverlap(night2, night1), true);
});

test("midnight boundary adjacency (20:00–00:00 and 00:00–06:00) does not overlap", () => {
  const preMidnight = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("00:00") };
  const postMidnight = { start: parseTimeToMinutes("00:00"), end: parseTimeToMinutes("06:00") };
  assert.equal(checkIntervalOverlap(preMidnight, postMidnight), false);
  assert.equal(checkIntervalOverlap(postMidnight, preMidnight), false);
});

test("midnight boundary overlap (20:00–00:01 and 00:00–06:00) is detected", () => {
  const preMidnight = { start: parseTimeToMinutes("20:00"), end: parseTimeToMinutes("00:01") };
  const postMidnight = { start: parseTimeToMinutes("00:00"), end: parseTimeToMinutes("06:00") };
  assert.equal(checkIntervalOverlap(preMidnight, postMidnight), true);
  assert.equal(checkIntervalOverlap(postMidnight, preMidnight), true);
});

test("rejects non-zero seconds in time format", () => {
  assert.throws(() => parseTimeToMinutes("08:00:15"), /format/);
  assert.throws(() => parseTimeToMinutes("08:00:00"), /format/);
});

test("exact minute precision accepts 00 seconds and rejects fractional or non-zero seconds", () => {
  assert.equal(minutesFromTime("06:00"), 360);
  assert.equal(minutesFromTime("06:00:00"), 360);
  assert.equal(minutesFromTime("06:00:00.1"), null);
  assert.equal(minutesFromTime("06:00:00.4"), null);
  assert.equal(minutesFromTime("06:00:01"), null);
  assert.equal(minutesFromTime("06:00:59"), null);
});

test("simulates concurrent overlapping writes serialized via lock", async () => {
  class LockedSubmissionSchedule {
    private entries: Interval[] = [];
    private lockQueue: Promise<void> = Promise.resolve();

    async addEntry(entry: Interval): Promise<boolean> {
      let releaseLock: () => void;
      const currentLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      const previousLock = this.lockQueue;
      this.lockQueue = this.lockQueue.then(() => currentLock);

      await previousLock;
      try {
        for (const existing of this.entries) {
          if (checkIntervalOverlap(entry, existing)) {
            throw new Error("Daily activity entries cannot overlap");
          }
        }
        this.entries.push(entry);
        return true;
      } finally {
        releaseLock!();
      }
    }

    get count() {
      return this.entries.length;
    }
  }

  const schedule = new LockedSubmissionSchedule();

  const attempt1 = schedule.addEntry({
    start: parseTimeToMinutes("08:00"),
    end: parseTimeToMinutes("10:00"),
  });
  const attempt2 = schedule.addEntry({
    start: parseTimeToMinutes("09:00"),
    end: parseTimeToMinutes("11:00"),
  });

  const results = await Promise.allSettled([attempt1, attempt2]);
  const successes = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(schedule.count, 1);
  assert.match(
    (failures[0] as PromiseRejectedResult).reason.message,
    /Daily activity entries cannot overlap/,
  );
});

test("simulates submission rollback when any schedule entry or answer fails validation", () => {
  // Simulating transactional behavior of submit_participant_survey RPC
  interface DatabaseState {
    submissions: string[];
    answers: Array<{ submissionId: string; questionId: string }>;
    schedules: Array<{ submissionId: string; sequence: number; start: string; end: string }>;
    consents: Array<{ submissionId: string; type: string }>;
  }

  const db: DatabaseState = {
    submissions: [],
    answers: [],
    schedules: [],
    consents: [],
  };

  function executeSubmissionTransaction(
    submissionId: string,
    answers: Array<{ questionId: string; answer: unknown }>,
    activities: Array<{ start: string; end: string }>,
  ) {
    // Transaction savepoint
    const snapshot = {
      submissions: [...db.submissions],
      answers: [...db.answers],
      schedules: [...db.schedules],
      consents: [...db.consents],
    };

    try {
      // 1. Insert submission
      db.submissions.push(submissionId);

      // 2. Insert answers
      for (const ans of answers) {
        db.answers.push({ submissionId, questionId: ans.questionId });
      }

      // 3. Insert schedule entries with overlap validation
      const existingIntervals: Interval[] = [];
      for (let i = 0; i < activities.length; i++) {
        const act = activities[i];
        const newInterval = {
          start: parseTimeToMinutes(act.start),
          end: parseTimeToMinutes(act.end),
        };
        for (const existing of existingIntervals) {
          if (checkIntervalOverlap(newInterval, existing)) {
            throw new Error(`Daily activity entries cannot overlap at entry ${i + 1}`);
          }
        }
        existingIntervals.push(newInterval);
        db.schedules.push({
          submissionId,
          sequence: i + 1,
          start: act.start,
          end: act.end,
        });
      }

      // 4. Insert consents
      db.consents.push({ submissionId, type: "research_participation" });
      db.consents.push({ submissionId, type: "public_display" });

      return { success: true };
    } catch (error) {
      // Rollback on any failure
      db.submissions = snapshot.submissions;
      db.answers = snapshot.answers;
      db.schedules = snapshot.schedules;
      db.consents = snapshot.consents;
      throw error;
    }
  }

  // Attempt a submission with an invalid overlapping schedule (3rd entry overlaps 1st)
  assert.throws(
    () =>
      executeSubmissionTransaction(
        "sub-fail",
        [{ questionId: "q1", answer: "Val" }],
        [
          { start: "08:00", end: "10:00" },
          { start: "10:00", end: "12:00" },
          { start: "09:00", end: "11:00" }, // Overlap!
        ],
      ),
    /Daily activity entries cannot overlap/,
  );

  // Entire transaction rolled back: no submission, answers, or schedule entries persisted
  assert.equal(db.submissions.length, 0);
  assert.equal(db.answers.length, 0);
  assert.equal(db.schedules.length, 0);
  assert.equal(db.consents.length, 0);

  // Now execute a valid submission transaction
  const valid = executeSubmissionTransaction(
    "sub-pass",
    [{ questionId: "q1", answer: "Val" }],
    [
      { start: "08:00", end: "10:00" },
      { start: "10:00", end: "12:00" },
      { start: "12:00", end: "14:00" },
    ],
  );
  assert.equal(valid.success, true);
  assert.equal(db.submissions.length, 1);
  assert.equal(db.answers.length, 1);
  assert.equal(db.schedules.length, 3);
  assert.equal(db.consents.length, 2);
  assert.equal(db.schedules[0].sequence, 1);
  assert.equal(db.schedules[1].sequence, 2);
  assert.equal(db.schedules[2].sequence, 3);
});
