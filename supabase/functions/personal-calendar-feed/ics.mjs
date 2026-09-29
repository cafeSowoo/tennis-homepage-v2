// Turns an iCalendar (.ics) feed into per-day calendar items in Seoul time.
// ICAL (ical.js) is passed in so the Edge Function (npm: import) and the Node tests share this file.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const partsFormatters = new Map();
function zoneParts(ms, zone) {
  let formatter = partsFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    partsFormatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  return parts;
}

function isValidZone(zone) {
  if (!zone || typeof zone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock time in `zone` -> epoch ms (two passes handle DST edges).
export function zonedToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, zone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = zoneParts(guess, zone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = wall - (asUtc - guess);
  }
  return guess;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate({ year, month, day }) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function propertyTzid(component, name) {
  const prop = component?.getFirstProperty(name);
  const tzid = prop?.getParameter("tzid");
  return typeof tzid === "string" ? tzid.replace(/^\/+/, "") : "";
}

function timeToUtcMs(time, tzid, defaultZone) {
  if (time.zone && time.zone.tzid === "UTC") {
    return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  }
  const candidate = time.timezone || tzid;
  const zone = isValidZone(candidate) ? candidate : defaultZone;
  return zonedToUtc(time, zone);
}

function hashId(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function cleanText(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

// One occurrence -> one item per Seoul calendar day it touches, clipped to [fromDate, toDate).
function occurrenceItems({ uid, start, end, item, masterTzid, defaultZone, displayZone, fromDate, toDate }) {
  const status = cleanText(item.component.getFirstPropertyValue("status"), 20).toUpperCase();
  if (status === "CANCELLED") return [];
  const title = cleanText(item.summary, 200) || "(제목 없음)";
  const location = cleanText(item.location, 200);
  const base = { title, location };
  const items = [];
  const push = (date, extra) => {
    if (date < fromDate || date >= toDate) return;
    items.push({ id: `pcal-${hashId(`${uid}|${start.toString()}|${date}`)}`, date, ...base, ...extra });
  };

  if (start.isDate) {
    const first = isoDate(start);
    let last = end && end.isDate ? isoDate(end) : addDays(first, 1);
    if (last <= first) last = addDays(first, 1);
    for (let date = first, guard = 0; date < last && guard < 400; date = addDays(date, 1), guard += 1) {
      push(date, { allDay: true, startTime: "", endTime: "" });
    }
    return items;
  }

  const startTzid = propertyTzid(item.component, "dtstart") || masterTzid;
  const endTzid = propertyTzid(item.component, "dtend") || startTzid;
  const startMs = timeToUtcMs(start, startTzid, defaultZone);
  let endMs = end ? timeToUtcMs(end, endTzid, defaultZone) : startMs;
  if (endMs < startMs) endMs = startMs;
  const s = zoneParts(startMs, displayZone);
  const e = zoneParts(endMs, displayZone);
  const startDate = isoDate(s);
  const endDate = isoDate(e);
  const startTime = `${pad(s.hour)}:${pad(s.minute)}`;
  const endTime = `${pad(e.hour)}:${pad(e.minute)}`;

  if (startDate === endDate) {
    push(startDate, { allDay: false, startTime, endTime: endMs > startMs ? endTime : "" });
    return items;
  }
  push(startDate, { allDay: false, startTime, endTime: "24:00" });
  for (let date = addDays(startDate, 1), guard = 0; date < endDate && guard < 400; date = addDays(date, 1), guard += 1) {
    push(date, { allDay: true, startTime: "", endTime: "" });
  }
  if (endTime !== "00:00") push(endDate, { allDay: false, startTime: "00:00", endTime });
  return items;
}

export function parseIcsEvents(ICAL, text, {
  from,
  to,
  displayZone = "Asia/Seoul",
  defaultZone = "Asia/Seoul",
  maxItems = 3000,
  maxIterations = 20000,
} = {}) {
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "") || from >= to) throw new Error("INVALID_RANGE");
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  // Generous UTC bounds; exact clipping happens per Seoul day in occurrenceItems.
  const fromMs = zonedToUtc({ year: fy, month: fm, day: fd }, displayZone) - 2 * DAY_MS;
  const toMs = zonedToUtc({ year: ty, month: tm, day: td }, displayZone) + DAY_MS;

  let root;
  try {
    root = new ICAL.Component(ICAL.parse(String(text)));
  } catch {
    throw new Error("INVALID_ICS");
  }
  if (root.name !== "vcalendar") throw new Error("INVALID_ICS");

  const masters = new Map();
  const exceptions = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const uid = String(vevent.getFirstPropertyValue("uid") || "");
    if (vevent.hasProperty("recurrence-id")) exceptions.push({ uid, vevent });
    else masters.set(uid || `no-uid-${masters.size}`, vevent);
  }

  const events = [];
  for (const [uid, vevent] of masters) {
    let event;
    try {
      event = new ICAL.Event(vevent);
    } catch {
      continue;
    }
    for (const ex of exceptions) {
      if (ex.uid !== uid) continue;
      try {
        event.relateException(ex.vevent);
      } catch {
        // Ignore malformed overrides and keep the regular occurrence.
      }
      ex.related = true;
    }
    events.push({ uid, event, masterTzid: propertyTzid(vevent, "dtstart") });
  }
  // Overrides whose series is missing from the feed still show as single events.
  for (const ex of exceptions) {
    if (ex.related) continue;
    try {
      events.push({ uid: ex.uid, event: new ICAL.Event(ex.vevent), masterTzid: propertyTzid(ex.vevent, "dtstart") });
    } catch {
      // Skip unreadable events.
    }
  }

  const items = [];
  let truncated = false;
  let iterations = 0;
  const ctx = { defaultZone, displayZone, fromDate: from, toDate: to };
  const collect = (uid, start, end, item, masterTzid) => {
    for (const row of occurrenceItems({ uid, start, end, item, masterTzid, ...ctx })) {
      if (items.length >= maxItems) {
        truncated = true;
        return;
      }
      items.push(row);
    }
  };

  for (const { uid, event, masterTzid } of events) {
    if (truncated) break;
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      const startMs = timeToUtcMs(event.startDate, masterTzid, defaultZone);
      const endMs = event.endDate ? timeToUtcMs(event.endDate, propertyTzid(event.component, "dtend") || masterTzid, defaultZone) : startMs;
      if (endMs < fromMs || startMs > toMs) continue;
      collect(uid, event.startDate, event.endDate, event, masterTzid);
      continue;
    }
    let iterator;
    try {
      iterator = event.iterator();
    } catch {
      continue;
    }
    let next;
    while ((next = iterator.next())) {
      iterations += 1;
      if (iterations > maxIterations) {
        truncated = true;
        break;
      }
      let details;
      try {
        details = event.getOccurrenceDetails(next);
      } catch {
        continue;
      }
      const itemTzid = propertyTzid(details.item.component, "dtstart") || masterTzid;
      const startMs = timeToUtcMs(details.startDate, itemTzid, defaultZone);
      // Moved occurrences can land later than their slot, so stop on the original slot time.
      const slotMs = timeToUtcMs(next, masterTzid, defaultZone);
      if (slotMs > toMs && startMs > toMs) break;
      const endMs = details.endDate ? timeToUtcMs(details.endDate, propertyTzid(details.item.component, "dtend") || itemTzid, defaultZone) : startMs;
      if (endMs < fromMs || startMs > toMs) continue;
      collect(uid, details.startDate, details.endDate, details.item, masterTzid);
      if (truncated) break;
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) ||
    Number(b.allDay) - Number(a.allDay) ||
    a.startTime.localeCompare(b.startTime) ||
    a.title.localeCompare(b.title, "ko"));
  return { events: items, truncated };
}
