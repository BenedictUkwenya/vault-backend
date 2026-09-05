const supabase = require('../config/supabase');
const logger = require('../config/logger');

const MARKET_SELECT = 'id, name, city, state, country, is_launched, waitlist_count, created_at, updated_at';

async function findMarketByCity(city) {
  const norm = String(city || '').trim();
  if (!norm) return null;

  const { data: exact } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .ilike('city', norm)
    .maybeSingle();
  if (exact) return exact;

  const { data: rows } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .ilike('city', `%${norm}%`)
    .order('is_launched', { ascending: false })
    .limit(1);
  return rows?.[0] || null;
}

async function findMarketById(id) {
  if (!id) return null;
  const { data } = await supabase.from('markets').select(MARKET_SELECT).eq('id', id).maybeSingle();
  return data;
}

async function syncWaitlistCount(marketId) {
  if (!marketId) return;
  const { count, error } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .eq('market_id', marketId);

  if (error) {
    logger.warn('syncWaitlistCount failed', { marketId, message: error.message });
    return;
  }

  await supabase
    .from('markets')
    .update({ waitlist_count: count || 0, updated_at: new Date().toISOString() })
    .eq('id', marketId);
}

async function syncAllWaitlistCounts() {
  const { data: markets } = await supabase.from('markets').select('id');
  if (!markets?.length) return;
  await Promise.all(markets.map((m) => syncWaitlistCount(m.id)));
}

async function listPublicMarkets() {
  await syncAllWaitlistCounts();
  const { data, error } = await supabase
    .from('markets')
    .select(MARKET_SELECT)
    .order('is_launched', { ascending: false })
    .order('name');
  if (error) throw new Error(error.message);
  return data || [];
}

async function getStatusForCity(city) {
  const market = await findMarketByCity(city);
  if (!market) {
    return {
      status: 'none',
      market: null,
      message: 'We are not in this city yet. Join a waitlist below to help us expand.',
    };
  }
  if (market.is_launched) {
    return {
      status: 'launched',
      market,
      message: `${market.name} is live — deals and businesses are filtered to ${market.city}.`,
    };
  }
  return {
    status: 'waitlist',
    market,
    message: `${market.name} is coming soon. Join the waitlist — we'll email and notify you at launch.`,
  };
}

async function resolveMarket({ market_id, city }) {
  if (market_id) {
    const byId = await findMarketById(market_id);
    if (byId) return byId;
  }
  if (city) return findMarketByCity(city);
  return null;
}

module.exports = {
  findMarketByCity,
  findMarketById,
  syncWaitlistCount,
  syncAllWaitlistCounts,
  listPublicMarkets,
  getStatusForCity,
  resolveMarket,
  MARKET_SELECT,
};
