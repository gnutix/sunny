import { PLACES, HORIZON_START, HORIZON_STEP } from './places.js';
import { WEBCAMS } from './webcams.js';
import { parseEnsemble, evaluate } from './forecast.js';
import { parseOpeningHours, isOpen } from './hours.js';

const TZ = 'Europe/Zurich';
const HOME = PLACES.find((p) => p.id === 'home');
const DESTINATIONS = PLACES.filter((p) => p !== HOME);
const FORECAST_MAX_AGE = 30 * 60e3;
const $ = (id) => document.getElementById(id);

/* ---------- Storage ---------- */

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`sun.${key}`)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`sun.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const state = {
  day: 0, // days from today
  leave: null, // 'HH:MM', or null for now
  sort: store.get('sort', 'best'),
  maxDrive: store.get('maxDrive', 90),
  googleKey: store.get('googleKey', ''),
  open: new Set(),
  forecasts: null, // id -> parsed ensemble
  fetchedAt: 0,
  drives: null, // id -> { minutes, km }
  driveSource: 'osrm',
};

/* ---------- Time in Lausanne ---------- */

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  weekday: 'short', hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zurich(ms) {
  const p = Object.fromEntries(partsFormat.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, minute: +p.minute, weekday: WEEKDAYS.indexOf(p.weekday) };
}

function zurichToMs(y, m, d, hour, minute) {
  let ms = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const z = zurich(ms);
    ms -= Date.UTC(z.y, z.m - 1, z.d, z.hour, z.minute) - Date.UTC(y, m - 1, d, hour, minute);
  }
  return ms;
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => { const z = zurich(ms); return `${z.hour}:${pad(z.minute)}`; };

function duration(minutes) {
  const m = Math.round(minutes / 5) * 5;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}

function departure() {
  const now = Date.now();
  if (state.day === 0 && !state.leave) return now;
  const today = zurich(now);
  const date = new Date(Date.UTC(today.y, today.m - 1, today.d + state.day));
  const [h, mi] = (state.leave || '10:00').split(':').map(Number);
  return zurichToMs(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, mi);
}

/* ---------- Data ---------- */

// Kept in the browser for FORECAST_MAX_AGE, so reloading the page doesn't spend Open-Meteo's free quota
async function fetchForecasts() {
  const all = PLACES;
  const signature = all.map((p) => `${p.id}@${p.lat},${p.lon}`).join(';');
  const cached = !state.forecasts && store.get('forecast', null);
  if (cached?.signature === signature) {
    state.forecasts = cached.forecasts;
    state.fetchedAt = cached.fetchedAt;
    if (Date.now() - state.fetchedAt < FORECAST_MAX_AGE) return;
  }
  const params = new URLSearchParams({
    latitude: all.map((p) => p.lat).join(','),
    longitude: all.map((p) => p.lon).join(','),
    elevation: all.map((p) => p.elevation ?? 'nan').join(','),
    hourly: 'sunshine_duration',
    models: 'meteoswiss_icon_ch1,meteoswiss_icon_ch2',
    forecast_days: '5',
    timeformat: 'unixtime',
  });
  const response = await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`);
  if (!response.ok) throw new Error(`forecast: HTTP ${response.status}`);
  const data = await response.json();
  const list = Array.isArray(data) ? data : [data];
  state.forecasts = Object.fromEntries(all.map((p, i) => [p.id, parseEnsemble(list[i].hourly)]));
  state.fetchedAt = Date.now();
  store.set('forecast', { signature, fetchedAt: state.fetchedAt, forecasts: state.forecasts });
}

// OSRM's public server: free, no key, no traffic. Distances don't change, so they are kept.
async function fetchOsrmDrives() {
  const signature = PLACES.map((p) => `${p.id}@${p.lat},${p.lon}`).join(';');
  const cached = store.get('osrm', null);
  if (cached?.signature === signature) return cached.drives;
  const coords = [HOME, ...DESTINATIONS].map((p) => `${p.lon},${p.lat}`).join(';');
  const response = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
  if (!response.ok) throw new Error(`routing: HTTP ${response.status}`);
  const data = await response.json();
  const drives = Object.fromEntries(DESTINATIONS.map((p, i) => [p.id, {
    minutes: data.durations[0][i + 1] / 60,
    km: data.distances[0][i + 1] / 1000,
  }]));
  store.set('osrm', { signature, drives });
  return drives;
}

// Google's Routes API with live or predicted traffic, when a key is saved
async function fetchGoogleDrives(leaveAt) {
  const point = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } } });
  const body = {
    origins: [point(HOME)],
    destinations: DESTINATIONS.map(point),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  if (leaveAt > Date.now() + 60e3) body.departureTime = new Date(leaveAt).toISOString();
  const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': state.googleKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Google: HTTP ${response.status}`);
  const drives = {};
  for (const e of await response.json()) {
    if (e.condition !== 'ROUTE_EXISTS') continue;
    drives[DESTINATIONS[e.destinationIndex].id] = { minutes: parseInt(e.duration, 10) / 60, km: e.distanceMeters / 1000 };
  }
  return drives;
}

let driveRequest = 0;
async function loadDrives() {
  const request = ++driveRequest;
  if (state.googleKey) {
    try {
      const drives = await fetchGoogleDrives(departure());
      if (request !== driveRequest) return;
      state.drives = drives;
      state.driveSource = 'google';
      return;
    } catch (error) {
      console.warn(error);
      state.driveSource = 'google-failed';
    }
  } else {
    state.driveSource = 'osrm';
  }
  const drives = await fetchOsrmDrives();
  if (request === driveRequest) state.drives = drives;
}

/* ---------- Evaluation ---------- */

function results() {
  const leave = departure();
  const home = state.forecasts && evaluate(HOME, state.forecasts[HOME.id], leave, HORIZON_START, HORIZON_STEP);
  const rows = DESTINATIONS.map((place) => {
    const drive = state.drives?.[place.id];
    if (!drive || !state.forecasts) return { place, drive };
    const arrival = leave + drive.minutes * 60e3;
    return { place, drive, arrival, ...evaluate(place, state.forecasts[place.id], arrival, HORIZON_START, HORIZON_STEP) };
  });
  return { leave, home: { place: HOME, arrival: leave, ...home }, rows };
}

const sunScore = (r) => (r.window && r.expected != null ? r.expected : -1);
// Sun counts only from arrival, so a long drive already loses daylight; on top of that,
// every minute in the car is a minute not spent in the sun.
const netScore = (r) => (r.window && r.expected != null ? r.expected - (r.drive?.minutes ?? 0) : -Infinity);
const SORTS = {
  best: (a, b) => netScore(b) - netScore(a) || a.drive.minutes - b.drive.minutes,
  sun: (a, b) => sunScore(b) - sunScore(a) || a.drive.minutes - b.drive.minutes,
  sure: (a, b) => (b.probability ?? -1) - (a.probability ?? -1) || sunScore(b) - sunScore(a),
  drive: (a, b) => a.drive.minutes - b.drive.minutes,
};

/* ---------- Rendering ---------- */

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function renderDays() {
  const today = zurich(Date.now());
  const names = ['Today', 'Tomorrow'];
  $('days').innerHTML = [0, 1, 2, 3, 4].map((offset) => {
    const weekday = WEEKDAYS[(today.weekday + offset) % 7];
    return `<button type="button" data-day="${offset}" aria-pressed="${state.day === offset}">${names[offset] ?? weekday}</button>`;
  }).join('');
}

function renderControls() {
  renderDays();
  const leave = departure();
  const z = zurich(leave);
  if (document.activeElement !== $('leave')) $('leave').value = `${pad(z.hour)}:${pad(z.minute)}`;
  $('now').hidden = state.day === 0 && !state.leave;
  $('max-drive').value = String(state.maxDrive);
  for (const b of $('sort').children) b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort));
}

/** Whether staying home is sunny enough, and the place worth driving to, if any. */
function outlook(home, shown) {
  const homeSunny = !!(home.window && home.probability >= 0.6 && home.expected >= 30);
  // Worth the drive only with clearly more sun than at home, once the drive is paid for
  const atHome = homeSunny ? home.expected : 0;
  const best = shown.filter((r) => r.window && r.probability >= 0.5 && r.expected >= 20 && netScore(r) > atHome + 15).sort(SORTS.best)[0];
  return { homeSunny, best };
}

// A real chance of sun, however small it is or far away the place
const someChance = (r) => r.window && r.probability >= 0.1;

function verdict(leave, home, shown, all) {
  const z = zurich(leave);
  const when = state.day === 0 && !state.leave ? 'now' : `at ${z.hour}:${pad(z.minute)}`;
  const day = ['', 'Tomorrow', ...['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => `On ${d}`)];
  const prefix = state.day === 0 ? '' : state.day === 1 ? 'Tomorrow, ' : `${day[2 + z.weekday]}, `;
  if (!state.forecasts || !state.drives) return 'Reading the forecast…';
  const parts = [];
  const { homeSunny, best } = outlook(home, shown);
  if (!home.window && !shown.some((r) => r.window)) {
    return state.day === 0 ? 'The sun has set everywhere within reach. Look at tomorrow.' : `${prefix}the sun will have set by the time you get anywhere.`;
  }
  if (homeSunny) {
    parts.push(`La Sallaz gets about <strong>${duration(home.expected)}</strong> of sun before ${clock(home.window.end)}, no need to drive.`);
  } else if (home.window && home.probability != null) {
    parts.push(`La Sallaz stays grey: ${Math.round(home.probability * 100)}% chance of sun before ${clock(home.window.end)}.`);
  }
  if (best) {
    parts.push(`${homeSunny ? 'For more, leaving' : 'Leaving'} ${when}, your best bet is <strong>${escape(best.place.name)}</strong>, ${duration(best.drive.minutes)} away: about <strong>${duration(best.expected)}</strong> of sun until ${clock(best.window.end)}, ${Math.round(best.probability * 100)}% sure.`);
  } else if (homeSunny) {
    parts.push('No place within reach is worth the drive.');
  } else if (!someChance(home) && !all.some(someChance)) {
    return state.day === 0 && !state.leave ? 'There\'s no chance to get any more sun today.'
      : `${prefix || 'Today, '}leaving ${when}, there's no chance to get any sun.`;
  } else {
    const farther = outlook(home, all).best;
    parts.push(farther
      ? `Leaving ${when}, no place within ${duration(state.maxDrive)} is likely to get you sun. Farther out, <strong>${escape(farther.place.name)}</strong>, ${duration(farther.drive.minutes)} away, gets about <strong>${duration(farther.expected)}</strong> of sun, ${Math.round(farther.probability * 100)}% sure.`
      : `Leaving ${when}, no place is likely to get you sun before it sets. Try another day.`);
  }
  if (prefix) parts[0] = prefix + parts[0].replace(/^(Leaving|For|No)\b/, (w) => w.toLowerCase());
  return parts.join(' ');
}

function timeline(leave, rows) {
  const ends = rows.map((r) => r.window?.end).filter(Boolean);
  const from = leave;
  const to = Math.max(from + 3 * 3600e3, ...ends) + 10 * 60e3;
  const x = (ms) => `${((ms - from) / (to - from)) * 100}%`;
  const ticks = [];
  for (let t = Math.ceil(from / 3600e3) * 3600e3; t < to; t += 3600e3) ticks.push(t);
  return { from, to, x, ticks };
}

function renderAxis(scale) {
  // About 36 px per label, and none over the departure time on the left
  const width = $('axis').clientWidth || 800;
  const every = Math.max(1, Math.ceil((scale.ticks.length * 36) / width));
  const labels = scale.ticks.filter((t, i) => i % every === 0 && ((t - scale.from) / (scale.to - scale.from)) * width > 52);
  $('axis').innerHTML = `<span style="left:0">${state.day === 0 && !state.leave ? 'Now' : clock(scale.from)}</span>`
    + labels.map((t) => `<span style="left:${scale.x(t)}">${zurich(t).hour}h</span>`).join('');
}

function strip(r, scale) {
  const ticks = scale.ticks.map((t) => `<i class="tick" style="left:${scale.x(t)}"></i>`).join('');
  const drive = r.arrival > scale.from ? `<i class="drive" style="left:0;width:${scale.x(r.arrival)}"></i>` : '';
  // Steps start on the 5-minute grid; the first one is drawn from the arrival itself
  const lit = (r.segments ?? []).map((s, i) => {
    const from = i === 0 && s.from - r.arrival < 5 * 60e3 ? r.arrival : s.from;
    return `<i class="lit" style="left:${scale.x(from)};width:calc(${scale.x(s.to)} - ${scale.x(from)});--p:${s.p.toFixed(2)}"></i>`;
  }).join('');
  return `<span class="strip">${ticks}${drive}${lit}</span>`;
}

function stats(r) {
  const drive = r.place === HOME ? '<span class="stat none"><b>Here</b>no drive</span>'
    : r.drive ? `<span class="stat"><b>${duration(r.drive.minutes)}</b>${Math.round(r.drive.km)} km</span>`
    : '<span class="stat none"><b>…</b>drive</span>';
  if (!state.forecasts) return `${drive}<span class="stat none"><b>…</b>sun</span><span class="stat none"><b>…</b>sure</span>`;
  if (!r.window) return `${drive}<span class="stat none"><b>Set</b>by arrival</span><span class="stat none"><b>–</b>sure</span>`;
  if (r.probability == null) return `${drive}<span class="stat none"><b>${duration(r.possible)}</b>no forecast yet</span><span class="stat none"><b>?</b>sure</span>`;
  return `${drive}<span class="stat"><b>${duration(r.expected)}</b>sun till ${clock(r.window.end)}</span>`
    + `<span class="stat"><b>${Math.round(r.probability * 100)}%</b>sure</span>`;
}

function row(r, scale) {
  const p = r.place;
  const home = p === HOME;
  const open = state.open.has(p.id);
  const label = `<span class="label"><span class="name">${escape(p.name)}</span><span class="where">${escape(p.area)}, ${p.elevation} m</span></span>`;
  const inner = `${label}${stats(r)}${r.arrival ? strip(r, scale) : ''}`;
  if (home) return `<li class="place home"><div class="row">${inner}</div></li>`;
  return `<li class="place" data-id="${p.id}"><button type="button" class="row" aria-expanded="${open}">${inner}</button>`
    + `<div class="detail"${open ? '' : ' hidden'}>${open ? detail(r) : ''}</div></li>`;
}

function detail(r) {
  const p = r.place;
  const out = [];
  if (r.window) {
    const ridge = r.window.flatSunset - r.window.end >= 10 * 60e3
      ? ` The sun goes behind the terrain at ${clock(r.window.end)}, ${duration((r.window.flatSunset - r.window.end) / 60e3)} before it would set over a flat horizon.`
      : ` The sun sets at ${clock(r.window.end)}.`;
    const start = r.window.start - r.arrival > 5 * 60e3 ? ` It reaches the place at ${clock(r.window.start)}.` : '';
    const odds = r.probability != null
      ? ` ${r.sunny} of ${r.runs} forecast runs give you at least ${Math.round(Math.min(20, r.possible / 2))} minutes of sun here.`
      : ' This is beyond the forecast\'s reach.';
    out.push(`<p>Arriving around ${clock(r.arrival)}.${start}${ridge}${odds}</p>`);
  } else if (r.arrival) {
    out.push(`<p>Arriving around ${clock(r.arrival)}, after the sun has gone for the day.</p>`);
  }
  if (p.blurb) out.push(`<p>${escape(p.blurb)}</p>`);
  const cam = WEBCAMS[p.id];
  if (cam?.image) {
    out.push(`<figure class="cam"><div class="frame${cam.panorama ? ' pano' : ''}"><img src="${cam.image}${cam.image.includes('?') ? '&' : '?'}t=${Math.floor(Date.now() / 300e3)}" alt="Latest webcam picture: ${escape(cam.label)}" loading="lazy"></div>`
      + `<figcaption>Latest picture from <a href="${cam.page}" target="_blank" rel="noopener">${escape(cam.label)}</a>${cam.panorama ? ', scroll sideways for the full panorama' : ''}.</figcaption></figure>`);
  }
  const sunGone = r.window?.end ?? r.arrival;
  out.push(`<div class="food" data-food="${p.id}"><h3>Open when the sun goes${sunGone ? ` (${clock(sunGone)})` : ''}</h3>${foodList(p, sunGone)}</div>`);
  const directions = `https://www.google.com/maps/dir/?api=1&origin=${HOME.lat},${HOME.lon}&destination=${p.lat},${p.lon}&travelmode=driving`;
  const nearby = `https://www.google.com/maps/search/restaurants/@${p.lat},${p.lon},14z`;
  out.push(`<p class="links"><a href="${directions}" target="_blank" rel="noopener">Directions in Google Maps</a>`
    + `<a href="${nearby}" target="_blank" rel="noopener">Restaurants in Google Maps</a>`
    + (cam && !cam.image ? `<a href="${cam.page}" target="_blank" rel="noopener">Webcam: ${escape(cam.label)}</a>` : '')
    + '</p>');
  return out.join('');
}

/* ---------- Restaurants (OpenStreetMap) ---------- */

const food = {}; // id -> 'loading' | 'error' | list
const FOOD_MAX_AGE = 7 * 864e5; // restaurants change slowly, and the public servers are often busy
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function overpass(query) {
  for (const wait of [0, 4000, 12000]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    for (const server of OVERPASS) {
      try {
        const response = await fetch(server, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(15e3) });
        if (response.ok) return await response.json();
      } catch (error) {
        console.warn(error);
      }
    }
  }
  throw new Error('Overpass servers busy');
}

async function loadFood(place) {
  if (food[place.id] && food[place.id] !== 'error') return;
  const cached = store.get(`food.${place.id}`, null);
  if (cached && Date.now() - cached.at < FOOD_MAX_AGE) {
    food[place.id] = cached.list;
    return;
  }
  food[place.id] = 'loading';
  const query = `[out:json][timeout:20];nwr(around:4000,${place.lat},${place.lon})[amenity~"^(restaurant|cafe|bar|pub|biergarten)$"][name];out center tags 80;`;
  try {
    const data = await overpass(query);
    food[place.id] = data.elements.map((e) => ({
      name: e.tags.name,
      kind: e.tags.cuisine?.split(';')[0].replace(/_/g, ' ') || e.tags.amenity,
      hours: e.tags.opening_hours,
      town: e.tags['addr:city'] || place.area,
      km: distanceKm(place, { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }),
    })).sort((a, b) => a.km - b.km);
    store.set(`food.${place.id}`, { at: Date.now(), list: food[place.id] });
  } catch {
    food[place.id] = 'error';
  }
  if (document.querySelector(`[data-food="${place.id}"]`)) render();
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

function foodList(place, at) {
  const list = food[place.id];
  if (!list || list === 'loading') return '<p class="more">Looking for restaurants nearby…</p>';
  if (list === 'error') return '<p class="more">OpenStreetMap\'s servers are busy. Close and reopen this place to try again, or use the Google Maps link below.</p>';
  if (!at) return '';
  const z = zurich(at + 15 * 60e3);
  const minute = z.hour * 60 + z.minute;
  const tagged = list.map((r) => ({ ...r, open: isOpen(parseOpeningHours(r.hours), z.weekday, minute) }));
  const open = tagged.filter((r) => r.open === true).slice(0, 8);
  const unknown = tagged.filter((r) => r.open === null).slice(0, Math.max(0, 6 - open.length));
  const closed = tagged.filter((r) => r.open === false).length;
  const item = (r) => {
    const search = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${r.town}`)}`;
    const note = r.open ? `${r.kind}, ${r.km.toFixed(1)} km` : `${r.kind}, ${r.km.toFixed(1)} km, hours not listed`;
    return `<li><a href="${search}" target="_blank" rel="noopener"${r.hours ? ` title="${escape(r.hours)}"` : ''}>${escape(r.name)}</a><small>${escape(note)}</small></li>`;
  };
  if (!open.length && !unknown.length) {
    return `<p class="more">${closed ? `The ${closed} places within 4 km are closed by then.` : 'No restaurant within 4 km on OpenStreetMap.'}</p>`;
  }
  return `<ul>${open.map(item).join('')}${unknown.map(item).join('')}</ul>`
    + (closed ? `<p class="more">${closed} more within 4 km are closed by then.</p>` : '');
}

/* ---------- Page ---------- */

function render() {
  renderControls();
  const { leave, home, rows } = results();
  const reachable = rows.filter((r) => r.drive && (!state.maxDrive || r.drive.minutes <= state.maxDrive));
  const sorted = state.forecasts && state.drives ? [...reachable].sort(SORTS[state.sort]) : rows;
  sorted.sort((a, b) => Number(!a.window && !!state.forecasts) - Number(!b.window && !!state.forecasts));
  const scale = timeline(leave, [home, ...sorted]);
  renderAxis(scale);
  $('verdict').innerHTML = verdict(leave, home, sorted, rows.filter((r) => r.drive));
  $('places').innerHTML = row(home, scale) + sorted.map((r) => row(r, scale)).join('');
  renderTitle(home, sorted);
  renderStatus();
}

// No sun to be had: here goes the sun, and it sinks into the fog
function renderTitle(home, shown) {
  const { homeSunny, best } = outlook(home, shown);
  const gloomy = state.forecasts && state.drives && !homeSunny && !best;
  const verb = gloomy ? 'Goes' : 'Comes';
  $('title-verb').textContent = `Here ${verb}`;
  document.title = `Here ${verb} the Sun`;
  const rise = gloomy ? 0.05 : Math.max(best?.probability ?? 0, homeSunny ? home.probability : 0) || 0.25;
  document.documentElement.style.setProperty('--rise', String(rise));
}

function renderStatus() {
  const hidden = DESTINATIONS.length - document.querySelectorAll('.place[data-id]').length;
  const parts = [];
  if (state.fetchedAt) parts.push(`Forecast read at ${clock(state.fetchedAt)}; it refreshes by itself.`);
  if (hidden > 0 && state.drives) parts.push(`${hidden} more place${hidden > 1 ? 's' : ''} beyond ${duration(state.maxDrive)} of driving.`);
  if (state.error) parts.push(state.error);
  $('status').textContent = parts.join(' ');
  $('drive-source').textContent = state.driveSource === 'google' ? 'Google Maps, with traffic'
    : state.driveSource === 'google-failed' ? 'OpenStreetMap routing, without traffic (Google Maps refused the key)'
    : 'OpenStreetMap routing, without traffic';
}

async function refresh(force = false) {
  state.error = null;
  const jobs = [];
  if (force || !state.forecasts || Date.now() - state.fetchedAt > FORECAST_MAX_AGE) jobs.push(fetchForecasts());
  if (force || !state.drives) jobs.push(loadDrives());
  const outcomes = await Promise.allSettled(jobs);
  const failed = outcomes.find((o) => o.status === 'rejected');
  if (failed) state.error = `Could not load everything (${failed.reason.message}). It tries again every minute.`;
  render();
}

/* ---------- Events ---------- */

$('days').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.day = +b.dataset.day;
  if (state.day > 0 && !state.leave) state.leave = '10:00';
  if (state.day === 0 && state.leave === '10:00' && Date.now() > departure()) state.leave = null;
  if (state.driveSource === 'google') loadDrives().then(render);
  render();
});
$('leave').addEventListener('change', (e) => {
  state.leave = e.target.value || null;
  if (state.driveSource === 'google') loadDrives().then(render);
  render();
});
$('now').addEventListener('click', () => {
  state.day = 0;
  state.leave = null;
  render();
});
$('max-drive').addEventListener('change', (e) => {
  state.maxDrive = +e.target.value;
  store.set('maxDrive', state.maxDrive);
  render();
});
$('sort').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.sort = b.dataset.sort;
  store.set('sort', state.sort);
  render();
});
$('places').addEventListener('click', (e) => {
  const b = e.target.closest('button.row');
  if (!b) return;
  const id = b.closest('.place').dataset.id;
  if (state.open.has(id)) state.open.delete(id);
  else {
    state.open.add(id);
    loadFood(DESTINATIONS.find((p) => p.id === id));
  }
  render();
});
$('key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.googleKey = $('google-key').value.trim();
  store.set('googleKey', state.googleKey);
  state.drives = null;
  refresh();
});
$('google-key').value = state.googleKey;

document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 60e3); // "now" moves on, the forecast ages

refresh();

navigator.serviceWorker?.register('sw.js').catch(() => { /* needs HTTPS */ });
