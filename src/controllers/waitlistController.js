const supabase = require('../config/supabase');
const marketsService = require('../services/marketsService');
const emailService = require('../services/emailService');
const logger = require('../config/logger');

async function join(req, res) {
  const { email: bodyEmail, city, market_id } = req.body;
  const email = (req.user?.email || bodyEmail || '').trim().toLowerCase();
  if (!email) return res.status(422).json({ error: 'email is required' });

  const market = await marketsService.resolveMarket({ market_id, city });
  if (!market) {
    return res.status(404).json({
      error: 'No market found for that city. Pick a city from the list or ask an admin to add it.',
    });
  }

  if (market.is_launched) {
    return res.status(400).json({
      error: `${market.name} is already live — update your city in Profile to see local deals.`,
      market,
      status: 'launched',
    });
  }

  const insert = {
    email,
    city: market.city,
    market_id: market.id,
    user_id: req.user?.id || null,
  };

  const { data, error } = await supabase.from('waitlist').insert(insert).select().single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'You are already on the waitlist for this city.',
        market,
        already_joined: true,
      });
    }
    return res.status(400).json({ error: error.message });
  }

  await marketsService.syncWaitlistCount(market.id);

  if (req.user?.id) {
    await supabase
      .from('profiles')
      .update({
        city: market.city,
        market_id: market.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.user.id);
  }

  try {
    await emailService.sendWaitlistJoinedEmail(email, {
      marketName: market.name,
      city: market.city,
    });
  } catch (err) {
    logger.warn('waitlist join email failed', { email, message: err.message });
  }

  res.status(201).json({
    ...data,
    market,
    message: `You're on the waitlist for ${market.name}. We'll email and notify you when we launch in ${market.city}.`,
  });
}

async function myStatus(req, res) {
  if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  const city = req.query.city || req.profile?.city;
  const statusInfo = await marketsService.getStatusForCity(city || '');

  let onWaitlist = false;
  if (statusInfo.market) {
    const { data } = await supabase
      .from('waitlist')
      .select('id, created_at')
      .eq('market_id', statusInfo.market.id)
      .ilike('email', req.user.email.toLowerCase())
      .maybeSingle();
    onWaitlist = !!data;
  }

  res.json({
    city: city || null,
    ...statusInfo,
    on_waitlist: onWaitlist,
  });
}

module.exports = { join, myStatus };
