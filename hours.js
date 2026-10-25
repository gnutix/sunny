// A small reader for OpenStreetMap's opening_hours, enough for most restaurants:
// "Mo-Fr 11:30-14:00,18:00-22:00; Sa,Su 10:00-23:00; Tu off", "24/7", hours past midnight.
// Anything fancier (months, week numbers, sunset…) gives null, shown as "hours not listed".

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseDays(selector) {
  const days = new Set();
  for (const part of selector.split(',')) {
    const range = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!range) return null;
    const a = DAYS.indexOf(range[1]);
    const b = range[2] ? DAYS.indexOf(range[2]) : a;
    for (let d = a; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === b) break;
    }
  }
  return days;
}

function parseTimes(text) {
  const spans = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
    if (!m) return null;
    const from = +m[1] * 60 + +m[2];
    let to = +m[3] * 60 + +m[4];
    if (to <= from) to += 24 * 60;
    spans.push([from, to]);
  }
  return spans;
}

/** Weekly schedule: for each weekday, a list of [fromMinute, toMinute] (toMinute may pass 24:00). */
export function parseOpeningHours(value) {
  if (!value) return null;
  const text = value.trim();
  if (text === '24/7') return Array.from({ length: 7 }, () => [[0, 24 * 60]]);
  const week = Array.from({ length: 7 }, () => []);
  for (let rule of text.split(';')) {
    rule = rule.trim();
    if (!rule) continue;
    if (/^PH\b/.test(rule)) continue; // public holidays: ignored
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(?:,\s*PH)?\s*(.*)$/);
    if (!m) return null;
    const days = m[1] ? parseDays(m[1].replace(/,$/, '')) : new Set(DAYS.keys());
    if (!days) return null;
    const rest = m[2].trim();
    const spans = /^(off|closed)$/i.test(rest) ? [] : parseTimes(rest);
    if (!spans) return null;
    for (const d of days) week[d] = spans; // later rules override earlier ones for their days
  }
  return week;
}

/** true / false, or null when the hours are unknown. `weekday` 0 = Sunday, `minute` since midnight. */
export function isOpen(schedule, weekday, minute) {
  if (!schedule) return null;
  if (schedule[weekday].some(([a, b]) => minute >= a && minute < b)) return true;
  const yesterday = schedule[(weekday + 6) % 7];
  return yesterday.some(([, b]) => b > 24 * 60 && minute < b - 24 * 60);
}
