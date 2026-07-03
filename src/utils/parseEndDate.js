/**
 * Normalizes deal end dates from mobile forms into a valid TIMESTAMPTZ.
 * Accepts Date objects, ISO strings, or YYYY-MM-DD.
 */
function parseEndDate(value) {
  if (!value) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + 3);
    fallback.setHours(23, 59, 59, 999);
    return fallback.toISOString();
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }

  const raw = String(value).trim();

  if (/^\d{4}$/.test(raw)) {
    return new Date(`${raw}-12-31T23:59:59.999Z`).toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T23:59:59.999Z`).toISOString();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid end date. Use a full date like 2026-12-31.');
  }

  parsed.setHours(23, 59, 59, 999);
  return parsed.toISOString();
}

module.exports = { parseEndDate };
