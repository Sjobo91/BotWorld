// Where the sun is, from the real clock: used by the sky on the page and by
// solar farms on the server, so they agree on when it is day.
const DAY = 864e5;
const DEG = Math.PI / 180;

export function sunAt(ms, lat = 52.2, lon = 5.1) {
  const d = new Date(ms);
  const doy = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * DEG;
  const la = lat * DEG;
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const H = (utcHours + lon / 15 - 12) * 15 * DEG;
  const sinAlt = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(decl) * Math.cos(la));
  return { alt, az, sinAlt };
}

// 0 at night, 1 in full daylight.
export function daylight(ms, lat, lon) {
  return Math.max(0, Math.min(1, (sunAt(ms, lat, lon).sinAlt + 0.1) / 0.35));
}

// Northern hemisphere seasons by month: winter, spring, summer, autumn.
export function seasonAt(ms, lat = 52.2) {
  const m = new Date(ms).getUTCMonth();
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][m];
  if (lat >= 0) return north;
  return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[north];
}
