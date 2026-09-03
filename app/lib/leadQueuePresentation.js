const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function leadTimestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") {
    const milliseconds = value.toMillis();
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const milliseconds = new Date(value).getTime();
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

export function leadCreatedAt(row = {}) {
  return leadTimestampMillis(
    row.createdAt || row.contactedAt || row.acceptedAt || row.movedAt || row.updatedAt,
  );
}

export function compareOldestLead(left, right) {
  const leftTime = leadCreatedAt(left);
  const rightTime = leadCreatedAt(right);
  if (leftTime === null && rightTime === null) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;
  return leftTime - rightTime;
}

export function regularLeadAgeBand(value, now = Date.now()) {
  const createdAt = leadTimestampMillis(value);
  const currentTime = leadTimestampMillis(now);
  if (createdAt === null || currentTime === null) return "new";
  const age = Math.max(0, currentTime - createdAt);
  if (age >= 2 * DAY_MS) return "overdue";
  if (age >= DAY_MS) return "waiting";
  return "new";
}

function ordinalDay(day) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

export function formatLeadReceivedAt(value, now = Date.now()) {
  const createdAt = leadTimestampMillis(value);
  const currentTime = leadTimestampMillis(now);
  if (createdAt === null || currentTime === null) return "";

  const age = Math.max(0, currentTime - createdAt);
  if (age < MINUTE_MS) return "Now";
  if (age < HOUR_MS) {
    const minutes = Math.floor(age / MINUTE_MS);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (age < DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const received = new Date(createdAt);
  const current = new Date(currentTime);
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(received);
  const year = received.getFullYear() === current.getFullYear()
    ? ""
    : `, ${received.getFullYear()}`;
  return `${month} ${ordinalDay(received.getDate())}${year}`;
}
