const supabase = require('../config/supabase');

/** Everything an admin needs to review one business: the full application, owner, deals and checks. */
async function getBusiness(req, res) {
  const { id } = req.params;
  const { data: biz, error } = await supabase
    .from('businesses')
    .select('*, category:category_id(name)')
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const [owner, deals, checks] = await Promise.all([
    biz.owner_id
      ? supabase.from('profiles').select('id, full_name, email, membership_tier, created_at').eq('id', biz.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('deals')
      .select('id, title, discount_percentage, is_active, end_date, created_at, admin_suspended_at')
      .eq('business_id', id)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('verification_checks')
      .select('id, check_type, status, result_note, reviewed_at, expires_at')
      .eq('entity_type', 'business')
      .eq('entity_id', id),
  ]);

  const { category, ...rest } = biz;
  res.json({
    ...rest,
    category_name: category?.name || null,
    owner: owner.data || null,
    deals: deals.data || [],
    verifications: checks.data || [],
  });
}

module.exports = { getBusiness };
