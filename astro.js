// Sun position (after Vladimir Agafonkin's SunCalc) and the terrain horizon of a place.

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const OBLIQUITY = 23.4397 * RAD;

// The sun's centre is at -0.833° when its upper limb touches a flat horizon (refraction included)
export const SUNSET_ALTITUDE = -0.833;

const toDays = (ms) => ms / DAY_MS - 0.5 + 2440588 - 2451545;

/** Altitude above the horizon and compass bearing (0 = north, 90 = east), both in degrees. */
export function sunPosition(ms, lat, lon) {
  const d = toDays(ms);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: altitude / RAD, azimuth: (azimuth / RAD + 540) % 360 };
}

/** Elevation angle of the terrain at a compass bearing, interpolated from the place's profile. */
export function horizonAt(place, azimuth, start, step) {
  const profile = place.horizon;
  if (!profile) return 0;
  const x = (azimuth - start) / step;
  if (x < 0 || x > profile.length - 1) return 0;
  const i = Math.floor(x);
  const t = x - i;
  return i + 1 < profile.length ? profile[i] * (1 - t) + profile[i + 1] * t : profile[i];
}

/** Whether the sun's upper limb shows above the terrain (or above a flat horizon with `flat`). */
export function sunVisible(ms, place, start, step, flat = false) {
  const { altitude, azimuth } = sunPosition(ms, place.lat, place.lon);
  const horizon = flat ? 0 : Math.max(0, horizonAt(place, azimuth, start, step));
  return altitude > horizon + SUNSET_ALTITUDE;
}
