const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');

// ── Notification helper ───────────────────────────────────────────────────────
async function _notify(userId, title, body, type = 'booking', data = {}) {
  try {
    await supabase.from('notifications').insert({
      user_id: userId,
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
    .single();

  if (!business) return res.status(403).json({ error: 'No business found' });

  const { data, error } = await supabase
    .from('bookings_with_details')
    .select('*')
    .eq('business_id', business.id)
    .order('preferred_date', { ascending: true });

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

  const { data, error } = await supabase
    .from('bookings')
    .insert({
      user_id: req.user.id,
      business_id,
      deal_id: deal_id || null,
      service_requested,
      preferred_date,
      preferred_time,
      notes,
      status: 'pending',
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

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
      `${req.user.full_name || 'A member'} requested a booking for "${service_requested}".`,
      'booking',
      { booking_id: data.id }
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

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'approved',
      response_note: req.body.response_note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

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

  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'denied',
      response_note: req.body.response_note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

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

module.exports = { listForUser, listForBusiness, getById, create, cancel, approve, deny };
