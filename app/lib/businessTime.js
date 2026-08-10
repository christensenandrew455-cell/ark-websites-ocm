import {
  DEFAULT_TIME_ZONE,
  validTimeZone,
  zonedDateTimeToUtc,
  zonedParts,
} from "./timeWindows.js";

export const BUSINESS_TIME_ZONE = DEFAULT_TIME_ZONE;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function businessNow(date = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const parts = zonedParts(date, validTimeZone(timeZone));
  return {
    date,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    weekday: parts.weekday,
    dateKey: parts.dateKey,
    timeZone: parts.timeZone,
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

export function nextBusinessWeekdayDate(preferredDay, from = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const targetIndex = WEEKDAYS.findIndex((weekday) => weekday.toLowerCase() === String(preferredDay || "").trim().toLowerCase());
  if (targetIndex < 0) return null;

  const now = businessNow(from, timeZone);
  const currentIndex = WEEKDAYS.indexOf(now.weekday);
  let daysAhead = (targetIndex - currentIndex + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;

  const future = new Date(Date.UTC(now.year, now.month - 1, now.day + daysAhead));
  return {
    year: future.getUTCFullYear(),
    month: future.getUTCMonth() + 1,
    day: future.getUTCDate(),
    dateKey: future.toISOString().slice(0, 10),
  };
}

export function resolveEstimateSchedule(preferredDay, preferredTime, from = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  const zone = validTimeZone(timeZone);
  const date = nextBusinessWeekdayDate(preferredDay, from, zone);
  const time = parseTime(preferredTime);
  if (!date || !time) return null;

  const estimateAt = zonedDateTimeToUtc({ ...date, ...time }, zone);
  const followUpAt = new Date(estimateAt.getTime() + 30 * 60 * 1000);

  return {
    estimateAt,
    followUpAt,
    estimateDate: date.dateKey,
    estimateTime: String(preferredTime || "").trim(),
    timeZone: zone,
  };
}

export function isDateDue(dateKey, now = new Date(), timeZone = BUSINESS_TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return false;
  return String(dateKey) <= businessNow(now, timeZone).dateKey;
}
