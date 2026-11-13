export const scheduleLocationOptions = [
  "Home",
  "Road / Commuting",
  "Office / Workplace",
  "School / College",
  "Outdoor public space / Park",
  "Market / Commercial area",
  "Industrial / Construction area",
  "Other",
] as const;

export const scheduleActivityOptions = [
  "Sleeping / Resting",
  "Indoor work / Studying",
  "Commuting",
  "Walking / Exercising",
  "Outdoor work",
  "Shopping / Errands",
  "Household activities",
  "Other",
] as const;

export const COMMON_TIME_OPTIONS = [
  "06:00",
  "07:00",
  "08:00",
  "09:00",
  "12:00",
  "17:00",
  "18:00",
  "20:00",
] as const;

export const ALL_30_MIN_TIMES: string[] = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = (i % 2) * 30;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

export function formatTime12Hour(value: string): string {
  const mins = minutesFromTime(value);
  if (mins === null) return value;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinutes = String(minutes).padStart(2, "0");
  return `${displayHours}:${displayMinutes} ${period}`;
}

export function isOvernightActivity(startTime: string, endTime: string): boolean {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start === null || end === null || start === end) return false;
  return end < start;
}

export type DailyActivityEntry = {
  startTime: string;
  endTime: string;
  locationCategory: string;
  locationOther: string;
  activityCategory: string;
  activityOther: string;
};

export type ScheduleValidation = {
  errors: string[];
  totalMinutes: number;
  unallocatedMinutes: number;
};

export function createEmptyActivity(): DailyActivityEntry {
  return {
    startTime: "",
    endTime: "",
    locationCategory: "",
    locationOther: "",
    activityCategory: "",
    activityOther: "",
  };
}

export function minutesFromTime(value: string): number | null {
  // Allow HH:MM or HH:MM:00 (exact zero seconds only). Reject non-zero or fractional seconds (e.g. 06:00:00.1, 06:00:01).
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/u.test(value)) return null;
  const parts = value.split(":");
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  return hours * 60 + minutes;
}

export function activityDurationMinutes(entry: DailyActivityEntry): number | null {
  const start = minutesFromTime(entry.startTime);
  const end = minutesFromTime(entry.endTime);
  if (start === null || end === null || start === end) return null;
  return end > start ? end - start : 1440 - start + end;
}

function activitySegments(entry: DailyActivityEntry): Array<[number, number]> {
  const start = minutesFromTime(entry.startTime);
  const end = minutesFromTime(entry.endTime);
  if (start === null || end === null || start === end) return [];
  return end > start
    ? [[start, end]]
    : [[start, 1440], [0, end]];
}

function segmentsOverlap(
  left: Array<[number, number]>,
  right: Array<[number, number]>,
): boolean {
  return left.some(([leftStart, leftEnd]) =>
    right.some(([rightStart, rightEnd]) =>
      leftStart < rightEnd && rightStart < leftEnd,
    ),
  );
}

export function validateDailyActivities(
  entries: DailyActivityEntry[],
): ScheduleValidation {
  const errors: string[] = [];
  if (!entries.length) {
    return {
      errors: ["Add at least one daily activity."],
      totalMinutes: 0,
      unallocatedMinutes: 1440,
    };
  }

  const validEntries: DailyActivityEntry[] = [];
  let totalMinutes = 0;
  entries.forEach((entry, index) => {
    const position = index + 1;
    const start = minutesFromTime(entry.startTime);
    const end = minutesFromTime(entry.endTime);
    const duration = activityDurationMinutes(entry);
    if (start === null) errors.push(`Activity ${position}: enter a valid start time.`);
    if (end === null) errors.push(`Activity ${position}: enter a valid end time.`);
    if (start !== null && end !== null && start === end) {
      errors.push(`Activity ${position}: start and end times cannot be identical.`);
    }
    if (!entry.locationCategory) {
      errors.push(`Activity ${position}: choose a location.`);
    } else if (
      !scheduleLocationOptions.includes(
        entry.locationCategory as (typeof scheduleLocationOptions)[number],
      )
    ) {
      errors.push(`Activity ${position}: choose a listed location.`);
    } else if (entry.locationCategory === "Other" && !entry.locationOther.trim()) {
      errors.push(`Activity ${position}: describe the other location.`);
    }
    if (!entry.activityCategory) {
      errors.push(`Activity ${position}: choose an activity.`);
    } else if (
      !scheduleActivityOptions.includes(
        entry.activityCategory as (typeof scheduleActivityOptions)[number],
      )
    ) {
      errors.push(`Activity ${position}: choose a listed activity.`);
    } else if (entry.activityCategory === "Other" && !entry.activityOther.trim()) {
      errors.push(`Activity ${position}: describe the other activity.`);
    }
    if (duration !== null) {
      totalMinutes += duration;
      validEntries.push(entry);
    }
  });

  for (let left = 0; left < validEntries.length; left += 1) {
    for (let right = left + 1; right < validEntries.length; right += 1) {
      if (
        segmentsOverlap(
          activitySegments(validEntries[left]),
          activitySegments(validEntries[right]),
        )
      ) {
        errors.push(`Activities ${left + 1} and ${right + 1} overlap.`);
      }
    }
  }

  return {
    errors: [...new Set(errors)],
    totalMinutes,
    unallocatedMinutes: Math.max(0, 1440 - totalMinutes),
  };
}

export function formatActivityDuration(minutes: number | null): string {
  if (minutes === null) return "Enter both times";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (remainder) parts.push(`${remainder} minute${remainder === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 minutes";
}

export function toggleCheckboxSelection(
  current: string[],
  value: string,
  checked: boolean,
  specialValues: string[],
): string[] {
  if (!checked) return current.filter((item) => item !== value);
  if (specialValues.includes(value)) return [value];
  return [...current.filter((item) => !specialValues.includes(item)), value];
}
