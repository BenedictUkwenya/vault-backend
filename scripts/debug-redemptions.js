require('dotenv').config();
const supabase = require('../src/config/supabase');

const checks = [
  ['redemptions', 'verified_at'],
  ['redemptions', 'savings_amount'],
  ['deals', 'images'],
  ['deals', 'image_url'],
  ['deals', 'max_redemptions'],
  ['deals', 'requires_paid_tier'],
  ['profiles', 'push_token'],
  ['profiles', 'last_streak_at'],
  ['profiles', 'streak_count'],
  ['bookings', 'response_note'],
  ['businesses', 'rejection_reason'],
];

(async () => {
  for (const [table, column] of checks) {
    const { error } = await supabase.from(table).select(column).limit(1);
    console.log(`${table}.${column}: ${error ? 'MISSING (' + error.message + ')' : 'ok'}`);
  }

  const { error: bucketErr } = await supabase.storage.from('deal-images').list('', { limit: 1 });
  console.log(`storage bucket deal-images: ${bucketErr ? 'MISSING (' + bucketErr.message + ')' : 'ok'}`);
})();
