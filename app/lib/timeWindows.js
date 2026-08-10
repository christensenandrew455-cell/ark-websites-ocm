export const DEFAULT_TIME_ZONE = "America/New_York";

function text(value) {
  return String(value || "").trim();
}

export function validTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
  const candidate = text(value) || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return fallback;
  }
}

export function zonedParts(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const zone = validTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday,
    dateKey: `${values.year}-${values.month}-${values.day}`,
    timeZone: zone,
  };
}

export function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = DEFAULT_TIME_ZONE) {
  const zone = validTimeZone(timeZone);
  const expected = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(expected);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const represented = zonedParts(result, zone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second
    );
    const correction = expected - representedUtc;
    if (correction === 0) break;
    result = new Date(result.getTime() + correction);
  }

  return result;
}

export function calendarMonthWindow(timeZone = DEFAULT_TIME_ZONE, from = new Date()) {
  const zone = validTimeZone(timeZone);
  const current = zonedParts(from, zone);
  const nextYear = current.month === 12 ? current.year + 1 : current.year;
  const nextMonth = current.month === 12 ? 1 : current.month + 1;
  const startMs = zonedDateTimeToUtc({
    year: current.year,
    month: current.month,
    day: 1,
  }, zone).getTime();
  const endMs = zonedDateTimeToUtc({
    year: nextYear,
    month: nextMonth,
    day: 1,
  }, zone).getTime();

  return {
    monthKey: `${current.year}-${String(current.month).padStart(2, "0")}`,
    startMs,
    endMs,
    timeZone: zone,
  };
}

export function subscriptionPeriodWindow(subscription, fallback) {
  const safeFallback = fallback || calendarMonthWindow();
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const periods = (items.length ? items : [subscription])
    .map((item) => ({
      startMs: Number(item?.current_period_start || subscription?.current_period_start || 0) * 1000,
      endMs: Number(item?.current_period_end || subscription?.current_period_end || 0) * 1000,
    }))
    .filter((period) => period.startMs > 0 && period.endMs > period.startMs);

  if (!periods.length) return safeFallback;
  const startMs = Math.max(...periods.map((period) => period.startMs));
  const endMs = Math.min(...periods.map((period) => period.endMs));
  if (endMs <= startMs) return safeFallback;

  return {
    monthKey: new Date(startMs).toISOString().slice(0, 10),
    startMs,
    endMs,
    timeZone: safeFallback.timeZone || DEFAULT_TIME_ZONE,
  };
}

export function isWithinWindow(value, window) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(time) && time >= Number(window?.startMs) && time < Number(window?.endMs);
}
