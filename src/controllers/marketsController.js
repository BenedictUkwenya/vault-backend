const marketsService = require('../services/marketsService');
const supabase = require('../config/supabase');

async function list(req, res) {
  try {
    const markets = await marketsService.listPublicMarkets();
    res.json({ markets });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function status(req, res) {
  const city = req.query.city || req.body?.city;
  if (!city) return res.status(422).json({ error: 'city query parameter is required' });

  const statusInfo = await marketsService.getStatusForCity(city);

  let onWaitlist = false;
  if (req.user?.id && statusInfo.market) {
    const email = req.user.email?.toLowerCase();
    const { data } = await supabase
      .from('waitlist')
      .select('id')
      .eq('market_id', statusInfo.market.id)
      .ilike('email', email)
      .maybeSingle();
    onWaitlist = !!data;
  }

  res.json({ ...statusInfo, on_waitlist: onWaitlist });
}

module.exports = { list, status };
