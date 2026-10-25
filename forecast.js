// Turns an Open-Meteo ensemble forecast into "how much sun will I get from arrival to sunset,
// and how sure is it", with the sun hidden whenever it is behind the place's terrain.

import { sunPosition, sunVisible } from './astro.js';

export const STEP = 5 * 60e3;
const HOUR = 3600e3;
const SURE_MINUTES = 20; // a run "sees the sun" with this much of it, or half the window if shorter

/**
 * Open-Meteo gives each hour's sunshine at the END of the hour (unix seconds); every key
 * starting with sunshine_duration is one ensemble run (control and members, all models).
 */
export function parseEnsemble(hourly) {
  return {
    end: hourly.time.map((s) => s * 1000),
    runs: Object.keys(hourly).filter((k) => k.startsWith('sunshine_duration')).map((k) => hourly[k]),
  };
}

const hourIndex = (forecast, ms) => Math.ceil((ms - forecast.end[0]) / HOUR);

/**
 * The models count sunshine above a flat horizon. Share of that sun each run sees in hour i,
 * so the terrain mask can be applied on top without counting the sunset twice.
 */
function sunShare(forecast, place, i, run, cache) {
  if (!(i in cache)) {
    const from = forecast.end[i] - HOUR;
    let up = 0;
    for (let t = from; t < from + HOUR; t += STEP) if (sunVisible(t + STEP / 2, place, 0, 0, true)) up += STEP / 1000;
    cache[i] = up;
  }
  const value = forecast.runs[run][i];
  if (value == null) return null;
  return cache[i] > 0 ? Math.min(1, value / cache[i]) : 0;
}

/**
 * The stretch of sun after `arrival`: until the sun goes behind the terrain for good, that day.
 * Returns null for the window when the sun has already gone by then.
 */
export function sunWindow(place, arrival, start, step) {
  const t0 = Math.ceil(arrival / STEP) * STEP;
  const flatUp = (t) => sunVisible(t + STEP / 2, place, 0, 0, true);
  const visible = (t) => sunVisible(t + STEP / 2, place, start, step);
  let t = t0;
  // Arriving at night: before dawn, wait for the sun; after dusk, it is gone for the day
  if (!flatUp(t)) {
    if (altitude(place, t + 10 * 60e3) < altitude(place, t)) return null;
    const limit = t + 14 * HOUR;
    while (t < limit && !flatUp(t)) t += STEP;
    if (t >= limit) return null;
  }
  const steps = [];
  while (flatUp(t)) {
    if (visible(t)) steps.push(t);
    t += STEP;
  }
  if (!steps.length) return null;
  return { start: steps[0], end: steps[steps.length - 1] + STEP, flatSunset: t, steps };
}

const altitude = (place, ms) => sunPosition(ms, place.lat, place.lon).altitude;

/** Everything a row shows for one place and one arrival time. */
export function evaluate(place, forecast, arrival, start, step) {
  const window = sunWindow(place, arrival, start, step);
  if (!window) return { window: null };
  const cache = {};
  const total = forecast.runs.length;
  const minutes = new Array(total).fill(0);
  const valid = new Array(total).fill(true);
  for (const t of window.steps) {
    const i = hourIndex(forecast, t + STEP / 2);
    for (let r = 0; r < total; r++) {
      if (!valid[r]) continue;
      const share = i >= 0 && i < forecast.end.length ? sunShare(forecast, place, i, r, cache) : null;
      if (share == null) valid[r] = false;
      else minutes[r] += share * 5;
    }
  }
  const runs = minutes.filter((_, r) => valid[r]);
  const possible = window.steps.length * 5;
  const result = { window, possible, runs: runs.length };
  if (!runs.length) return result; // beyond the forecast's reach
  const threshold = Math.min(SURE_MINUTES, possible / 2);
  result.sunny = runs.filter((m) => m >= threshold).length;
  result.probability = result.sunny / runs.length;
  result.expected = runs.reduce((a, b) => a + b, 0) / runs.length;
  result.segments = segments(forecast, place, window, valid, cache);
  return result;
}

/** Contiguous runs of visible sun cut at the hours, each with the share of runs seeing sun then. */
function segments(forecast, place, window, valid, cache) {
  const out = [];
  for (const t of window.steps) {
    const i = hourIndex(forecast, t + STEP / 2);
    const last = out[out.length - 1];
    if (last && last.hour === i && last.to === t) { last.to = t + STEP; continue; }
    let yes = 0;
    let n = 0;
    for (let r = 0; r < forecast.runs.length; r++) {
      if (!valid[r]) continue;
      n++;
      if (sunShare(forecast, place, i, r, cache) >= 0.5) yes++;
    }
    out.push({ hour: i, from: t, to: t + STEP, p: n ? yes / n : 0 });
  }
  return out;
}
