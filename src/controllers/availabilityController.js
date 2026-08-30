const supabase = require('../config/supabase');

function todayIsoLocal() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function nowHHMM() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

function weekdayOfIsoDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function eachDateInclusive(from, to) {
  const dates = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function normalizeTime(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

async function _ownerBusiness(userId) {
  const { data } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('owner_id', userId)
    .maybeSingle();
  return data;
}

/** Build free-slot calendar for a business between from/to (inclusive YYYY-MM-DD). */
async function computeFreeDays(businessId, from, to) {
  const [{ data: template }, { data: blocks }, { data: held }] = await Promise.all([
    supabase
      .from('business_availability')
      .select('weekday, slot_time')
      .eq('business_id', businessId)
      .eq('is_active', true),
    supabase
      .from('business_availability_blocks')
      .select('blocked_date, blocked_time')
      .eq('business_id', businessId)
      .gte('blocked_date', from)
      .lte('blocked_date', to),
    supabase
      .from('bookings')
      .select('preferred_date, preferred_time')
      .eq('business_id', businessId)
      .in('status', ['pending', 'approved'])
      .gte('preferred_date', from)
      .lte('preferred_date', to),
  ]);

  const byWeekday = {};
  for (const row of template || []) {
    const t = normalizeTime(row.slot_time);
    if (!t) continue;
    if (!byWeekday[row.weekday]) byWeekday[row.weekday] = [];
    byWeekday[row.weekday].push(t);
  }
  for (const k of Object.keys(byWeekday)) {
    byWeekday[k].sort();
  }

  const blockedAllDay = new Set();
  const blockedSlots = new Set();
  for (const b of blocks || []) {
    const date = String(b.blocked_date).slice(0, 10);
    const t = normalizeTime(b.blocked_time);
    if (!t) blockedAllDay.add(date);
    else blockedSlots.add(`${date}|${t}`);
  }
  const heldSet = new Set(
    (held || []).map((b) => `${b.preferred_date}|${normalizeTime(b.preferred_time) || b.preferred_time}`)
  );

  const today = todayIsoLocal();
  const now = nowHHMM();
  const days = [];

  for (const date of eachDateInclusive(from, to)) {
    if (blockedAllDay.has(date)) continue;
    if (date < today) continue;
    const wd = weekdayOfIsoDate(date);
    const slots = (byWeekday[wd] || []).filter((slot) => {
      if (heldSet.has(`${date}|${slot}`)) return false;
      if (blockedSlots.has(`${date}|${slot}`)) return false;
      if (date === today && slot <= now) return false;
      return true;
    });
    if (slots.length) days.push({ date, slots });
  }

  return {
    schedule_configured: (template || []).length > 0,
    days,
  };
}

async function getPublicAvailability(req, res) {
  const businessId = req.params.id;
  const today = todayIsoLocal();
  let from = req.query.from || today;
  let to = req.query.to;

  if (!to) {
    const [y, m, d] = from.split('-').map(Number);
    const end = new Date(y, m - 1, d);
    end.setDate(end.getDate() + 29);
    to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  }

  if (from < today) from = today;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .maybeSingle();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const result = await computeFreeDays(businessId, from, to);
  res.json(result);
}

async function getMyAvailability(req, res) {
  const business = await _ownerBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'No business found' });

  const today = todayIsoLocal();
  const [{ data: slots, error }, { data: blocks }] = await Promise.all([
    supabase
      .from('business_availability')
      .select('id, weekday, slot_time, is_active')
      .eq('business_id', business.id)
      .order('weekday')
      .order('slot_time'),
    supabase
      .from('business_availability_blocks')
      .select('id, blocked_date, blocked_time, reason')
      .eq('business_id', business.id)
      .gte('blocked_date', today)
      .order('blocked_date')
      .order('blocked_time'),
  ]);

  if (error) return res.status(400).json({ error: error.message });

  const byWeekday = {};
  for (let i = 0; i <= 6; i++) byWeekday[i] = [];
  for (const row of slots || []) {
    if (!row.is_active) continue;
    byWeekday[row.weekday].push(normalizeTime(row.slot_time) || row.slot_time);
  }

  res.json({
    business_id: business.id,
    weekdays: byWeekday,
    slots: slots || [],
    blocks: blocks || [],
  });
}

async function putMyAvailability(req, res) {
  const business = await _ownerBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'No business found' });

  const { slots } = req.body;
  if (!Array.isArray(slots)) {
    return res.status(422).json({ error: 'slots must be an array of { weekday, times }' });
  }

  const rows = [];
  for (const entry of slots) {
    const weekday = Number(entry.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return res.status(422).json({ error: `Invalid weekday: ${entry.weekday}` });
    }
    const times = Array.isArray(entry.times) ? entry.times : [];
    const seen = new Set();
    for (const raw of times) {
      const t = normalizeTime(raw);
      if (!t) return res.status(422).json({ error: `Invalid time: ${raw}` });
      if (seen.has(t)) continue;
      seen.add(t);
      rows.push({
        business_id: business.id,
        weekday,
        slot_time: t,
        is_active: true,
      });
    }
  }

  const { error: delError } = await supabase
    .from('business_availability')
    .delete()
    .eq('business_id', business.id);

  if (delError) return res.status(400).json({ error: delError.message });

  if (rows.length) {
    const { error: insError } = await supabase.from('business_availability').insert(rows);
    if (insError) return res.status(400).json({ error: insError.message });
  }

  const refreshed = await getMyAvailabilityPayload(business.id);
  res.json(refreshed);
}

async function getMyAvailabilityPayload(businessId) {
  const today = todayIsoLocal();
  const [{ data: slots }, { data: blocks }] = await Promise.all([
    supabase
      .from('business_availability')
      .select('id, weekday, slot_time, is_active')
      .eq('business_id', businessId)
      .order('weekday')
      .order('slot_time'),
    supabase
      .from('business_availability_blocks')
      .select('id, blocked_date, blocked_time, reason')
      .eq('business_id', businessId)
      .gte('blocked_date', today)
      .order('blocked_date')
      .order('blocked_time'),
  ]);

  const byWeekday = {};
  for (let i = 0; i <= 6; i++) byWeekday[i] = [];
  for (const row of slots || []) {
    if (!row.is_active) continue;
    byWeekday[row.weekday].push(normalizeTime(row.slot_time) || row.slot_time);
  }

  return {
    business_id: businessId,
    weekdays: byWeekday,
    slots: slots || [],
    blocks: blocks || [],
  };
}

async function addBlock(req, res) {
  const business = await _ownerBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'No business found' });

  const blocked_date = req.body.blocked_date;
  const reason = req.body.reason || null;
  if (!blocked_date || !/^\d{4}-\d{2}-\d{2}$/.test(blocked_date)) {
    return res.status(422).json({ error: 'blocked_date must be YYYY-MM-DD' });
  }

  let rawTimes = [];
  if (Array.isArray(req.body.blocked_times)) rawTimes = req.body.blocked_times;
  else if (req.body.blocked_time) rawTimes = [req.body.blocked_time];

  const times = [];
  const seen = new Set();
  for (const raw of rawTimes) {
    const t = normalizeTime(raw);
    if (!t) return res.status(422).json({ error: `Invalid time: ${raw}` });
    if (seen.has(t)) continue;
    seen.add(t);
    times.push(t);
  }

  const allDay = times.length === 0;

  if (allDay) {
    const { error: delError } = await supabase
      .from('business_availability_blocks')
      .delete()
      .eq('business_id', business.id)
      .eq('blocked_date', blocked_date);
    if (delError) return res.status(400).json({ error: delError.message });

    const { data, error } = await supabase
      .from('business_availability_blocks')
      .insert({ business_id: business.id, blocked_date, blocked_time: null, reason })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(data);
  }

  const { error: clearDayError } = await supabase
    .from('business_availability_blocks')
    .delete()
    .eq('business_id', business.id)
    .eq('blocked_date', blocked_date)
    .is('blocked_time', null);
  if (clearDayError) return res.status(400).json({ error: clearDayError.message });

  const { error: clearTimesError } = await supabase
    .from('business_availability_blocks')
    .delete()
    .eq('business_id', business.id)
    .eq('blocked_date', blocked_date)
    .in('blocked_time', times);
  if (clearTimesError) return res.status(400).json({ error: clearTimesError.message });

  const rows = times.map((blocked_time) => ({
    business_id: business.id,
    blocked_date,
    blocked_time,
    reason,
  }));

  const { data, error } = await supabase
    .from('business_availability_blocks')
    .insert(rows)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

async function removeBlock(req, res) {
  const business = await _ownerBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'No business found' });

  const key = req.params.date || req.params.id;
  if (!key) return res.status(422).json({ error: 'Invalid block' });

  let query = supabase
    .from('business_availability_blocks')
    .delete()
    .eq('business_id', business.id);

  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    query = query.eq('blocked_date', key);
  } else {
    query = query.eq('id', key);
  }

  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

/** Shared validator used by bookings create */
async function assertSlotBookable(businessId, preferred_date, preferred_time) {
  const time = normalizeTime(preferred_time);
  if (!time) return { ok: false, status: 422, error: 'Invalid preferred_time' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferred_date)) {
    return { ok: false, status: 422, error: 'preferred_date must be YYYY-MM-DD' };
  }

  const today = todayIsoLocal();
  if (preferred_date < today) {
    return { ok: false, status: 400, error: 'Cannot book a past date' };
  }
  if (preferred_date === today && time <= nowHHMM()) {
    return { ok: false, status: 400, error: 'Cannot book a past time' };
  }

  const { data: template } = await supabase
    .from('business_availability')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .limit(1);

  if (!template || template.length === 0) {
    return { ok: false, status: 400, error: 'This business is not taking bookings yet' };
  }

  const { data: dateBlocks } = await supabase
    .from('business_availability_blocks')
    .select('id, blocked_time')
    .eq('business_id', businessId)
    .eq('blocked_date', preferred_date);

  const blockedHere = (dateBlocks || []).some((b) => {
    const t = normalizeTime(b.blocked_time);
    return !t || t === time;
  });
  if (blockedHere) {
    return { ok: false, status: 400, error: 'That date or time is unavailable' };
  }

  const weekday = weekdayOfIsoDate(preferred_date);
  const { data: slot } = await supabase
    .from('business_availability')
    .select('id')
    .eq('business_id', businessId)
    .eq('weekday', weekday)
    .eq('slot_time', time)
    .eq('is_active', true)
    .maybeSingle();

  if (!slot) {
    return { ok: false, status: 400, error: 'That time slot is not offered on this day' };
  }

  const { data: held } = await supabase
    .from('bookings')
    .select('id')
    .eq('business_id', businessId)
    .eq('preferred_date', preferred_date)
    .eq('preferred_time', time)
    .in('status', ['pending', 'approved'])
    .maybeSingle();

  if (held) {
    return { ok: false, status: 409, error: 'That slot was just taken' };
  }

  return { ok: true, time };
}

module.exports = {
  getPublicAvailability,
  getMyAvailability,
  putMyAvailability,
  addBlock,
  removeBlock,
  assertSlotBookable,
  normalizeTime,
  computeFreeDays,
};
