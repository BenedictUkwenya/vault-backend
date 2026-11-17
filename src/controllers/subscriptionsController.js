const supabase = require('../config/supabase');
const stripeService = require('../services/stripeService');
const membership = require('../services/membershipService');
const terms = require('../utils/termsAcceptance');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');

const TRIAL_PERIOD_DAYS = 7;
// Checkouts abandoned before payment leave these statuses behind; they don't use up the trial.
const NEVER_STARTED_STATUSES = new Set(['incomplete', 'incomplete_expired']);

/** The free trial is for first-time member subscribers only. Fails closed so a DB error never grants a trial. */
async function isTrialEligible(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('subscription_type, status')
    .eq('user_id', userId);
  if (error) return false;
  return !(data || []).some(
    (s) => s.subscription_type !== 'business' && !NEVER_STARTED_STATUSES.has(s.status)
  );
}

async function getPlans(_req, res) {
  res.json({
    member_plans: membership.MEMBER_PLANS,
    business_plan: membership.BUSINESS_PLAN,
    pro_plan: membership.PRO_PLAN,
  });
}

/** What each plan requires: Student needs a verified school email, provider plans need an approved application. */
async function planEligibility(userId, studentVerifiedAt) {
  const [{ data: biz }, { data: pro }] = await Promise.all([
    supabase.from('businesses').select('review_status, is_approved').eq('owner_id', userId).limit(1).maybeSingle(),
    supabase.from('bl_pros').select('status').eq('user_id', userId).maybeSingle(),
  ]);
  const businessStatus = biz ? biz.review_status || (biz.is_approved ? 'approved' : 'pending') : null;
  return {
    student: !!studentVerifiedAt,
    business: businessStatus === 'approved',
    business_status: businessStatus,
    pro: pro?.status === 'approved',
    pro_status: pro?.status || null,
  };
}

// Academic domains: .edu (US), .edu.ng / .edu.gh etc., .ac.uk / .ac.za etc.
const SCHOOL_EMAIL = /^[^\s@]+@([a-z0-9-]+\.)+(edu|edu\.[a-z]{2}|ac\.[a-z]{2})$/i;

async function sendStudentCode(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!SCHOOL_EMAIL.test(email)) {
    return res.status(400).json({ error: 'Use your school email address, for example name@school.edu or name@uni.edu.ng.' });
  }
  const { data: taken } = await supabase
    .from('profiles')
    .select('id')
    .ilike('student_email', email)
    .neq('id', req.user.id)
    .limit(1);
  if (taken?.length) return res.status(409).json({ error: 'That school email is already used by another account.' });

  const { code } = await otpService.issueOtp(email, 'student_verify');
  await emailService.sendEmail({
    to: email,
    subject: 'Your Black Limitless student code',
    html: emailService.wrapHtml({
      title: 'Verify your student status',
      bodyHtml: `<p>Enter this code in the app to unlock the Student plan:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p><p>It expires in 15 minutes. If you didn’t ask for this, you can ignore it.</p>`,
    }),
    text: `Your Black Limitless student code is ${code}. It expires in 15 minutes.`,
  });
  res.json({ sent: true });
}

async function verifyStudentCode(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const result = await otpService.verifyOtp(email, 'student_verify', req.body?.code);
  if (!result.ok) return res.status(400).json({ error: result.error || 'Invalid code' });
  const { error } = await supabase
    .from('profiles')
    .update({ student_verified_at: new Date().toISOString(), student_email: email })
    .eq('id', req.user.id);
  if (error?.code === '23505') return res.status(409).json({ error: 'That school email is already used by another account.' });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ verified: true });
}

/** Matches the redeem cap: verified this month plus unexpired (48h) unscanned QR codes. */
async function countVerifiedThisMonth(userId) {
  const { start, end } = membership.monthWindow();
  const pendingCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [verified, pending] = await Promise.all([
    supabase
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('verified_at', start)
      .lt('verified_at', end),
    supabase
      .from('redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('verified_at', null)
      .gte('redeemed_at', pendingCutoff),
  ]);
  return (verified.count || 0) + (pending.count || 0);
}

async function getStatus(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_tier, membership_expires_at, stripe_customer_id, student_verified_at')
    .eq('id', req.user.id)
    .single();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .in('status', ['active', 'trialing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const tier = membership.effectiveTier(profile);
  const limit = membership.redemptionLimitForTier(tier);
  const [used, trialEligible] = await Promise.all([
    countVerifiedThisMonth(req.user.id),
    isTrialEligible(req.user.id),
  ]);
  const remaining = limit == null ? null : Math.max(0, limit - used);
  const eligibility = await planEligibility(req.user.id, profile?.student_verified_at);

  res.json({
    is_active: membership.isMembershipActive(profile),
    eligibility,
    tier,
    expires_at: profile?.membership_expires_at,
    student_verified_at: profile?.student_verified_at ?? null,
    subscription,
    trial_eligible: trialEligible,
    trial_period_days: TRIAL_PERIOD_DAYS,
    redemptions: {
      used_this_month: used,
      limit,
      remaining,
    },
    plans: membership.MEMBER_PLANS,
  });
}

/** Only redirect back to our own web app or the mobile app's deep-link schemes. */
const DEFAULT_SITE = 'https://www.blacklimitless.com';

/** FRONTEND_URL may be missing or scheme-less on a deployment; Stripe needs an absolute URL. */
function siteUrl() {
  const raw = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+/i.test(raw) ? raw : DEFAULT_SITE;
}

function safeReturnUrl(url, fallbackPath) {
  const fallback = `${siteUrl()}${fallbackPath}`;
  if (!url || typeof url !== 'string') return fallback;
  // Expo builds app links as "blacklimitless:///membership"; Stripe rejects the empty host.
  const normalized = url.replace(/^([a-z][a-z0-9+.-]*):\/\/\/+/i, '$1://');
  const allowed = [siteUrl(), 'blacklimitless://', 'exp://', 'exps://'];
  return allowed.some((prefix) => normalized.startsWith(prefix)) ? normalized : fallback;
}

async function createCheckout(req, res) {
  const { success_url, cancel_url, type = 'member' } = req.body;
  const checkoutType = type === 'paid' ? 'member' : type;
  if (!['student', 'member', 'vip', 'business', 'pro'].includes(checkoutType)) {
    return res.status(422).json({ error: 'Unknown plan' });
  }

  const { data: flags } = await supabase.from('profiles').select('student_verified_at').eq('id', req.user.id).maybeSingle();
  const eligible = await planEligibility(req.user.id, flags?.student_verified_at);
  if (checkoutType === 'student' && !eligible.student) {
    return res.status(403).json({ error: 'Verify your school email to choose the Student plan.', code: 'student_verification_required' });
  }
  if (checkoutType === 'business' && !eligible.business) {
    return res.status(403).json({ error: 'The Founding Business plan opens once your business is approved.', code: 'business_required' });
  }
  if (checkoutType === 'pro' && !eligible.pro) {
    return res.status(403).json({ error: 'The BL Pro plan opens once your BL Pro application is approved.', code: 'pro_required' });
  }

  const { data: activeSubs } = await supabase
    .from('subscriptions')
    .select('id, subscription_type')
    .eq('user_id', req.user.id)
    .in('status', ['active', 'trialing', 'past_due']);
  // At most one member plan and one provider plan; Founding Business and BL Pro cover each other.
  const isProvider = (t) => membership.PROVIDER_TYPES.includes(t);
  if ((activeSubs || []).some((s) => isProvider(s.subscription_type) === isProvider(checkoutType))) {
    return res.status(409).json({
      error: 'You already have an active subscription. Use Manage billing to change plans.',
      use_portal: true,
    });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', req.user.id)
    .single();

  const customerId = await stripeService.getOrCreateCustomer(
    req.user.id,
    req.user.email,
    profile?.stripe_customer_id
  );

  // The price is always chosen server-side; a client-supplied price_id could pair a
  // cheap price with an expensive plan type.
  const priceId = membership.priceIdForCheckoutType(checkoutType);
  if (!priceId) {
    return res.status(400).json({
      error: `Stripe price not configured for plan "${checkoutType}". Set the matching STRIPE_*_PRICE_ID env var.`,
    });
  }

  const withTrial = !membership.PROVIDER_TYPES.includes(checkoutType) && (await isTrialEligible(req.user.id));

  if (terms.clientOnCurrentAgreements(req)) {
    if (req.body.billing_authorized !== true) {
      return res.status(400).json({
        error: 'Please authorize the recurring membership charge before checkout.',
        code: 'billing_authorization_required',
      });
    }
    const plan = checkoutType === 'business'
      ? membership.BUSINESS_PLAN
      : checkoutType === 'pro'
        ? membership.PRO_PLAN
        : membership.MEMBER_PLANS.find((item) => item.checkout_type === checkoutType);
    const trialDays = withTrial ? TRIAL_PERIOD_DAYS : null;
    await terms.recordAcceptance(req.user.id, {
      agreementId: 'subscription',
      checkboxText: terms.billingConsentText(plan?.price_label || '', trialDays || 0, trialDays),
    });
  }

  const session = await stripeService.createCheckoutSession({
    customerId,
    priceId,
    successUrl: safeReturnUrl(success_url, "/membership?success=true"),
    cancelUrl: safeReturnUrl(cancel_url, "/membership?canceled=true"),
    userId: req.user.id,
    subscriptionType: checkoutType,
    trialPeriodDays: withTrial ? TRIAL_PERIOD_DAYS : undefined,
  });

  res.json({ checkout_url: session.url, session_id: session.id });
}

async function createPortalSession(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripeService.createPortalSession(
    profile.stripe_customer_id,
    safeReturnUrl(req.body.return_url, "/membership")
  );

  res.json({ portal_url: session.url });
}

async function cancel(req, res) {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', req.user.id)
    .in('status', ['active', 'trialing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription) return res.status(404).json({ error: 'No active subscription' });

  await stripeService.cancelSubscription(subscription.stripe_subscription_id);

  res.json({ message: 'Subscription will cancel at end of billing period' });
}

module.exports = { sendStudentCode, verifyStudentCode, getPlans, getStatus, createCheckout, createPortalSession, cancel };
