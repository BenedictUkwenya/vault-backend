const DEFAULT_TZ = 'America/New_York';

function timezoneForCountry(country) {
  const c = String(country || '').trim().toLowerCase();
  if (['nigeria', 'ng'].includes(c)) return 'Africa/Lagos';
  if (['united kingdom', 'uk', 'gb', 'england'].includes(c)) return 'Europe/London';
  if (['ghana', 'gh'].includes(c)) return 'Africa/Accra';
  if (['kenya', 'ke'].includes(c)) return 'Africa/Nairobi';
  if (['south africa', 'za'].includes(c)) return 'Africa/Johannesburg';
  if (['canada', 'ca'].includes(c)) return 'America/Toronto';
  return DEFAULT_TZ;
}

function validTz(tz) {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

function parts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** YYYY-MM-DD for "today" in the given zone. */
function todayIn(tz, now = new Date()) {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM for "now" in the given zone. */
function nowHHMMIn(tz, now = new Date()) {
  const p = parts(now, tz);
  return `${p.hour}:${p.minute}`;
}

/** Offset (ms) of the zone from UTC at a given instant. */
function offsetMs(tz, at) {
  const p = parts(at, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** ISO instant for 23:59:59 local time on a YYYY-MM-DD date in the given zone. */
function endOfDayIn(dateStr, tz) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, 23, 59, 59);
  const first = naiveUtc - offsetMs(tz, new Date(naiveUtc));
  const corrected = naiveUtc - offsetMs(tz, new Date(first));
  return new Date(corrected).toISOString();
}

module.exports = { DEFAULT_TZ, timezoneForCountry, validTz, todayIn, nowHHMMIn, endOfDayIn };
