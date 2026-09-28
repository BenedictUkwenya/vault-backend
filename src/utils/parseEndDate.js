const { endOfDayIn, todayIn, DEFAULT_TZ } = require('./timezone');

/**
 * Normalizes deal end dates from mobile forms into a valid TIMESTAMPTZ at the end
 * of that day in the business's timezone (a bare 23:59:59Z expired US deals ~7pm).
 * Accepts Date objects, ISO strings, YYYY-MM-DD, or a bare year.
 */
function parseEndDate(value, tz = DEFAULT_TZ) {
  if (!value) {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 3);
    return endOfDayIn(todayIn(tz, d), tz);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return endOfDayIn(todayIn(tz, value), tz);
  }

  const raw = String(value).trim();

  if (/^\d{4}$/.test(raw)) return endOfDayIn(`${raw}-12-31`, tz);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return endOfDayIn(raw, tz);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid end date. Use a full date like 2026-12-31.');
  }
  return endOfDayIn(todayIn(tz, parsed), tz);
}

module.exports = { parseEndDate };
