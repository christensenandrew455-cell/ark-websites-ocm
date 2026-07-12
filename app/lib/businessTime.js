export const BUSINESS_TIME_ZONE = "America/New_York";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function partsFor(date, timeZone = BUSINESS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function businessNow(date = new Date()) {
  const parts = partsFor(date);
  return {
    date,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeZone: BUSINESS_TIME_ZONE,
  };
}

function parseTime(value) {
  const match = String(value || "").trim().toLowerCase().match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || "";

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
  }

  if (hour < 0 || hour > 23) return null;
  return { hour, minute };
}

function zonedDateTimeToUtc({ year, month, day, hour, minute }) {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(wallClockUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = partsFor(result);
    const representedWallClock = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const correction = wallClockUtc - representedWallClock;
    if (correction === 0) break;
    result = new Date(result.getTime() + correction);
  }

  return result;
}

export function nextBusinessWeekdayDate(preferredDay, from = new Date()) {
  const targetIndex = WEEKDAYS.findIndex((weekday) => weekday.toLowerCase() === String(preferredDay || "").trim().toLowerCase());
  if (targetIndex < 1 || targetIndex > 5) return null;

  const now = businessNow(from);
  const currentIndex = WEEKDAYS.indexOf(now.weekday);
  let daysAhead = (targetIndex - currentIndex + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;

  const noonUtc = Date.UTC(now.year, now.month - 1, now.day + daysAhead, 12, 0, 0);
  const future = partsFor(new Date(noonUtc));
  return {
    year: Number(future.year),
    month: Number(future.month),
    day: Number(future.day),
    dateKey: `${future.year}-${future.month}-${future.day}`,
  };
}

export function resolveEstimateSchedule(preferredDay, preferredTime, from = new Date()) {
  const date = nextBusinessWeekdayDate(preferredDay, from);
  const time = parseTime(preferredTime);
  if (!date || !time) return null;

  const estimateAt = zonedDateTimeToUtc({ ...date, ...time });
  const followUpAt = new Date(estimateAt.getTime() + 30 * 60 * 1000);

  return {
    estimateAt,
    followUpAt,
    estimateDate: date.dateKey,
    estimateTime: String(preferredTime || "").trim(),
    timeZone: BUSINESS_TIME_ZONE,
  };
}

export function isDateDue(dateKey, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return false;
  return String(dateKey) <= businessNow(now).dateKey;
}
