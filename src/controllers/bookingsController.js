const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');
const { assertSlotBookable } = require('./availabilityController');
const notificationService = require('../services/notificationService');
const { todayIn, nowHHMMIn, DEFAULT_TZ } = require('../utils/timezone');

const MAX_PENDING_PER_BUSINESS = 3;

// ── Notification helper ───────────────────────────────────────────────────────
async function _notify(userId, title, body, type = 'booking', data = {}) {
  try {
    await notificationService.createNotification({
      userId,
      title,
      body,
      type,
      data,
    });
  } catch (_) {
    // Non-fatal — don't block the main response
  }
}

async function listForUser(req, res) {
  const { data, error } = await supabase
    .from('bookings_with_details')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function listForBusiness(req, res) {
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) return res.status(403).json({ error: 'No business found' });

  const { data, error } = await supabase
    .from('bookings_with_details')
    .select('*')
    .eq('business_id', business.id)
    .order('preferred_date', { ascending: true })
    .order('preferred_time', { ascending: true })
    .limit(500);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getById(req, res) {
  const { data, error } = await supabase
    .from('bookings_with_details')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Booking not found' });

  if (data.user_id !== req.user.id) {
    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', req.user.id)
      .single();

    if (!business || business.id !== data.business_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
  }

  res.json(data);
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { business_id, deal_id, service_requested, preferred_date, preferred_time, notes } = req.body;

  // Accept YYYY-MM-DD even if client sent a full ISO datetime
  const dateOnly =
    typeof preferred_date === 'string' && preferred_date.includes('T')
      ? preferred_date.slice(0, 10)
      : preferred_date;

  const { data: targetBiz } = await supabase
    .from('businesses')
    .select('id, owner_id, is_approved')
    .eq('id', business_id)
    .maybeSingle();
  if (!targetBiz || !targetBiz.is_approved) return res.status(404).json({ error: 'Business not found' });
  if (targetBiz.owner_id === req.user.id) {
    return res.status(403).json({ error: 'You can’t book your own business.' });
  }

  if (deal_id) {
    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('id', deal_id)
      .eq('business_id', business_id)
      .maybeSingle();
    if (!deal) return res.status(422).json({ error: 'That deal doesn’t belong to this business' });
  }

  // Stop one member from holding a business's whole calendar with open requests.
  const { count: openCount } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('business_id', business_id)
    .eq('status', 'pending');
  if ((openCount || 0) >= MAX_PENDING_PER_BUSINESS) {
    return res.status(429).json({
      error: `You already have ${MAX_PENDING_PER_BUSINESS} pending requests here. Wait for the business to respond or cancel one.`,
    });
  }

  const slotCheck = await assertSlotBookable(business_id, dateOnly, preferred_time);
  if (!slotCheck.ok) return res.status(slotCheck.status).json({ error: slotCheck.error });

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id: req.user.id,
      business_id,
      deal_id: deal_id || null,
      service_requested,
      preferred_date: dateOnly,
      preferred_time: slotCheck.time,
      notes,
      status: 'pending',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That slot was just taken' });
    }
    return res.status(400).json({ error: error.message });
  }

  // Notify the member their booking is received
  await _notify(
    req.user.id,
    'Booking Requested 📅',
    `Your booking request has been received and is pending approval.`,
    'booking',
    { booking_id: data.id }
  );

  // Notify the business owner a new booking came in
  const { data: bizOwner } = await supabase
    .from('businesses')
    .select('owner_id, name')
    .eq('id', business_id)
    .single();

  if (bizOwner) {
    await _notify(
      bizOwner.owner_id,
      'New Booking Request 🔔',
      `${req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'A member'} requested a booking for "${service_requested}".`,
      'booking',
      { booking_id: data.id, audience: 'business' }
    );
  }

  res.status(201).json(data);
}

async function cancel(req, res) {
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .in('status', ['pending', 'approved'])
    .select()
    .single();

  if (error || !data) return res.status(400).json({ error: 'Cannot cancel this booking' });

  const { data: bizOwner } = await supabase
    .from('businesses')
    .select('owner_id, name')
    .eq('id', data.business_id)
    .single();

  if (bizOwner) {
    await _notify(
      bizOwner.owner_id,
      'Booking Cancelled',
      `A member cancelled their booking for "${data.service_requested}" on ${data.preferred_date} at ${data.preferred_time}.`,
      'booking',
      { booking_id: data.id, audience: 'business' }
    );
  }

  res.json(data);
}

async function _requireBusinessOwnership(req, bookingId) {
  const { data: booking } = await supabase
    .from('bookings')
    .select('business_id')
    .eq('id', bookingId)
    .single();

  if (!booking) return null;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .eq('id', booking.business_id)
    .single();

  return business ? booking : null;
}

async function approve(req, res) {
  const booking = await _requireBusinessOwnership(req, req.params.id);
  if (!booking) return res.status(403).json({ error: 'Unauthorized' });

  const { data: current } = await supabase.from('bookings').select('status').eq('id', req.params.id).single();
  if (!current || current.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be approved' });
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'approved',
      response_note: req.body.response_note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'This booking was already updated (maybe cancelled).' });

  // Notify the member
  await _notify(
    data.user_id,
    'Booking Approved ✅',
    `Your booking for "${data.service_requested}" has been approved!${data.response_note ? ' Note: ' + data.response_note : ''}`,
    'booking',
    { booking_id: data.id }
  );

  res.json(data);
}

async function deny(req, res) {
  const booking = await _requireBusinessOwnership(req, req.params.id);
  if (!booking) return res.status(403).json({ error: 'Unauthorized' });

  const { data: current } = await supabase.from('bookings').select('status').eq('id', req.params.id).single();
  if (!current || current.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be denied' });
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'denied',
      response_note: req.body.response_note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'This booking was already updated (maybe cancelled).' });

  // Notify the member
  await _notify(
    data.user_id,
    'Booking Not Approved',
    `Your booking for "${data.service_requested}" was not approved.${data.response_note ? ' Reason: ' + data.response_note : ''}`,
    'booking',
    { booking_id: data.id }
  );

  res.json(data);
}

async function complete(req, res) {
  const booking = await _requireBusinessOwnership(req, req.params.id);
  if (!booking) return res.status(403).json({ error: 'Unauthorized' });

  // Completing also pays the referrer, so it can't happen before the visit.
  const { data: slot } = await supabase
    .from('bookings')
    .select('preferred_date, preferred_time, businesses(timezone)')
    .eq('id', req.params.id)
    .single();
  if (slot) {
    const tz = slot.businesses?.timezone || DEFAULT_TZ;
    const today = todayIn(tz);
    const slotTime = String(slot.preferred_time || '').slice(0, 5);
    if (slot.preferred_date > today || (slot.preferred_date === today && slotTime > nowHHMMIn(tz))) {
      return res.status(400).json({ error: 'You can mark this complete once the appointment time has passed.' });
    }
  }

  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'approved')
    .select()
    .single();

  if (error || !data) return res.status(400).json({ error: 'Cannot complete this booking' });

  try {
    const referralService = require('../services/referralService');
    await referralService.recordReferralEvent(data.user_id, 'booking');
  } catch (_) {}

  await _notify(
    data.user_id,
    'Booking Completed',
    `Your booking for "${data.service_requested}" is marked complete.`,
    'booking',
    { booking_id: data.id }
  );

  res.json(data);
}

module.exports = { listForUser, listForBusiness, getById, create, cancel, approve, deny, complete };
