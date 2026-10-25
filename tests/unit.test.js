// node --test tests/*.test.js   (pure logic: sun position, terrain horizon, forecast maths, opening hours)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, sunVisible } from '../astro.js';
import { parseEnsemble, evaluate, sunWindow, STEP } from '../forecast.js';
import { parseOpeningHours, isOpen } from '../hours.js';

const lausanne = { lat: 46.5328, lon: 6.647 };
const utc = (s) => Date.parse(`${s}Z`);
const minutes = (ms) => Math.round(ms / 60e3);

function flatSunset(place, from) {
  let t = from;
  while (sunVisible(t, place, 0, 0, true)) t += 60e3;
  return t;
}

// Reference times from the astral Python package (NOAA algorithm), to within 3 minutes
test('sunset in Lausanne on 2026-10-25 is around 16:29 UTC (17:29 local)', () => {
  const sunset = flatSunset(lausanne, utc('2026-10-25T12:00'));
  assert.ok(Math.abs(sunset - utc('2026-10-25T16:29')) <= 3 * 60e3, new Date(sunset).toISOString());
});

test('the sun is due south at solar noon, high in June and low in December', () => {
  const june = sunPosition(utc('2026-06-21T11:35'), lausanne.lat, lausanne.lon);
  assert.ok(Math.abs(june.azimuth - 180) < 3, `azimuth ${june.azimuth}`);
  assert.ok(Math.abs(june.altitude - 66.9) < 0.5, `altitude ${june.altitude}`);
  const december = sunPosition(utc('2026-12-21T11:31'), lausanne.lat, lausanne.lon);
  assert.ok(Math.abs(december.altitude - 20) < 0.5, `altitude ${december.altitude}`);
});

test('a ridge in the west hides the sun earlier than a flat horizon', () => {
  const ridge = { ...lausanne, horizon: new Array(55).fill(0).map((_, i) => (45 + 5 * i >= 200 ? 8 : 0)) };
  const from = utc('2026-10-25T12:00');
  const flat = sunWindow(lausanne, from, 45, 5);
  const hidden = sunWindow(ridge, from, 45, 5);
  assert.ok(flat.end - hidden.end > 30 * 60e3, `${minutes(flat.end - hidden.end)} min`);
  assert.equal(hidden.flatSunset, flat.flatSunset);
});

test('no window when arriving after dusk; the morning window when arriving before dawn', () => {
  assert.equal(sunWindow(lausanne, utc('2026-10-25T18:30'), 45, 5), null);
  const morning = sunWindow(lausanne, utc('2026-10-26T04:00'), 45, 5);
  assert.ok(morning.start > utc('2026-10-26T06:00') && morning.start < utc('2026-10-26T06:45'), new Date(morning.start).toISOString());
});

function ensemble(fromIso, hours, runs) {
  const start = utc(fromIso) / 1000;
  const hourly = { time: Array.from({ length: hours }, (_, i) => start + 3600 * (i + 1)) };
  runs.forEach((fn, r) => { hourly[`sunshine_duration_member${r}`] = hourly.time.map((t, i) => fn(i, t)); });
  return parseEnsemble(hourly);
}

test('probability is the share of runs with at least 20 minutes of sun', () => {
  // 4 runs: two fully sunny, one sunny for a single hour, one grey
  const forecast = ensemble('2026-10-25T00:00', 48, [
    () => 3600, () => 3600, (i) => (i === 13 ? 3600 : 0), () => 0,
  ]);
  const r = evaluate(lausanne, forecast, utc('2026-10-25T12:00'), 45, 5);
  assert.equal(r.runs, 4);
  assert.equal(r.sunny, 3);
  assert.equal(r.probability, 0.75);
  // expected: (2 × the whole window + 60 min) / 4, the window running 12:00 to sunset (~16:24)
  assert.ok(Math.abs(r.expected - (2 * r.possible + 60) / 4) < 6, `${r.expected} vs ${r.possible}`);
});

test('the sunset hour is not counted twice: a run giving all the sun of a partial hour gives it all', () => {
  // The sun is above a flat horizon from 16:00 to ~16:30 only: a run reporting those 30 minutes is fully sunny
  const forecast = ensemble('2026-10-25T00:00', 48, [(i) => (i === 16 ? 30 * 60 : 3600)]);
  const r = evaluate(lausanne, forecast, utc('2026-10-25T15:00'), 45, 5);
  assert.ok(Math.abs(r.expected - r.possible) <= 5, `${r.expected} vs ${r.possible}`);
});

test('runs that stop before the window ends are left out', () => {
  const forecast = ensemble('2026-10-25T00:00', 48, [() => 3600, (i) => (i < 14 ? 3600 : null)]);
  const r = evaluate(lausanne, forecast, utc('2026-10-25T12:00'), 45, 5);
  assert.equal(r.runs, 1);
});

test('segments follow the hours and carry the share of sunny runs', () => {
  const forecast = ensemble('2026-10-25T00:00', 48, [() => 3600, (i) => (i === 13 ? 3600 : 0)]);
  const r = evaluate(lausanne, forecast, utc('2026-10-25T12:00'), 45, 5);
  assert.equal(r.segments[0].from, utc('2026-10-25T12:00'));
  assert.equal(r.segments[0].p, 0.5); // 12:00–13:00 UTC is hour 12, sunny in the first run only
  assert.equal(r.segments[1].p, 1); // 13:00–14:00 UTC, sunny in both
  assert.equal(r.segments[1].from, utc('2026-10-25T13:00'));
  assert.ok(r.segments.every((s) => (s.to - s.from) % STEP === 0));
});

test('opening hours: weekdays, overrides, past midnight, off, unknown', () => {
  const week = parseOpeningHours('Mo-Fr 11:30-14:00,18:00-22:00; Sa,Su 10:00-01:00; Tu off');
  assert.equal(isOpen(week, 1, 19 * 60), true); // Monday 19:00
  assert.equal(isOpen(week, 1, 16 * 60), false);
  assert.equal(isOpen(week, 2, 19 * 60), false); // Tuesday off
  assert.equal(isOpen(week, 6, 23 * 60 + 30), true); // Saturday late
  assert.equal(isOpen(week, 0, 30), true); // Sunday 00:30, from Saturday night
  assert.equal(isOpen(week, 1, 30), true); // Monday 00:30, from Sunday night
  assert.equal(isOpen(parseOpeningHours('24/7'), 3, 3 * 60), true);
  assert.equal(isOpen(parseOpeningHours('Jan-Mar Mo-Su 10:00-18:00'), 3, 12 * 60), null);
  assert.equal(isOpen(parseOpeningHours(undefined), 3, 12 * 60), null);
  assert.equal(isOpen(parseOpeningHours('Mo-Su 09:00-18:00; PH off'), 3, 12 * 60), true);
});
