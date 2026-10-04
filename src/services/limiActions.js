/**
 * Screens Limi may link to. Keys are what the model writes; hrefs are app routes.
 * Anything not listed here is dropped, so Limi can never produce a dead link.
 */
const SCREENS = {
  home: { href: '/(tabs)/home', label: 'Go to Home', about: 'Home feed: hot deals, picks of the week/month, Business of the Month, quick actions' },
  explore: { href: '/(tabs)/explore', label: 'Explore businesses', about: 'Browse and map partner businesses by category and city' },
  deals: { href: '/(tabs)/deals', label: 'Browse deals', about: 'All live deals, with This Week and College filters and city/country scope' },
  search: { href: '/search', label: 'Search', about: 'Search deals, businesses and app shortcuts' },
  card: { href: '/(tabs)/membership', label: 'Open my card', about: 'Membership card, current tier and benefits' },
  plans: { href: '/subscribe', label: 'See membership plans', about: 'Compare tiers, upgrade, start the free trial if eligible' },
  profile: { href: '/(tabs)/profile', label: 'Open profile', about: 'Profile menu with every account option' },
  edit_profile: { href: '/edit-profile', label: 'Edit profile', about: 'Change name, photo, city, contact details' },
  notifications: { href: '/notifications', label: 'Notifications', about: 'Inbox of alerts and updates' },
  bookings: { href: '/bookings', label: 'My bookings', about: 'Visit requests: pending, approved, past; cancel a booking' },
  wallet: { href: '/wallet', label: 'Wallet & savings', about: 'Redemption history and total money saved' },
  passport: { href: '/passport', label: 'Open Passport', about: 'Stamps earned from verified redemptions; full page unlocks a reward' },
  saved: { href: '/saved', label: 'Saved businesses', about: 'Businesses the member bookmarked' },
  referrals: { href: '/referrals', label: 'Invite & earn', about: 'Personal invite link and code, free-month progress, Ambassador Portal unlock' },
  vote: { href: '/vote', label: 'Vote Business of the Month', about: 'One vote per month for a favourite business' },
  media: { href: '/(tabs)/media', label: 'Watch Media', about: 'Media hub of clips and stories' },
  pros: { href: '/(tabs)/pros', label: 'Find a BL Pro', about: 'Verified independent professionals (BL Pros)' },
  pro_apply: { href: '/pro/apply', label: 'Apply to be a BL Pro', about: 'Application to become a verified BL Pro (portfolio + proof of services)' },
  founding_wall: { href: '/founding-wall', label: 'Founding Wall', about: 'Founding businesses, members and BL Pros' },
  waitlist: { href: '/waitlist', label: 'City waitlist', about: 'Join the waitlist for cities launching soon' },
  feedback: { href: '/feedback', label: 'Send feedback', about: 'Send ideas, bug reports or complaints to the team' },
  support: { href: '/legal?section=support', label: 'Contact support', about: 'Support page: email the team about account, billing, bookings, redemptions, privacy, deletion' },
  terms: { href: '/legal', label: 'Terms & privacy', about: 'Member, business and BL Pro terms, privacy policy' },
  business_register: { href: '/business-portal/register', label: 'List my business', about: 'Register a business to become a partner (reviewed by the team)' },
  business_dashboard: { href: '/(business-tabs)/dashboard', label: 'Business dashboard', about: 'Business owners only: listing status, deals, scanner, bookings', owner: true },
  business_profile: { href: '/business-portal/edit-profile', label: 'Edit business profile', about: 'Business owners only: category, location, hours, contact, socials, gallery', owner: true },
  availability: { href: '/business-portal/availability', label: 'Manage availability', about: 'Business owners only: weekly booking hours and closed dates', owner: true },
  scanner: { href: '/business-portal/scanner', label: 'Open scanner', about: 'Business owners only: scan a member QR to verify a redemption', owner: true },
};

const MAX_ACTIONS = 3;
const MARKER = /\[\[\s*button\s*:\s*([^|\]]{1,40}?)\s*\|\s*([a-z_]+(?::[0-9a-f-]{36})?)\s*\]\]/gi;

function screenGuide({ isOwner }) {
  return Object.entries(SCREENS)
    .filter(([, s]) => isOwner || !s.owner)
    .map(([key, s]) => `- ${key}: ${s.about}`)
    .join('\n');
}

/**
 * Pulls [[button:Label|target]] markers out of the reply and turns valid ones into actions.
 * target is a screen key, deal:<uuid> or business:<uuid> (ids must come from the live data).
 */
function extractActions(text, { dealIds, businessIds, isOwner }) {
  const actions = [];
  const seen = new Set();

  const cleaned = String(text || '').replace(MARKER, (_, rawLabel, target) => {
    if (actions.length >= MAX_ACTIONS || seen.has(target)) return '';
    const label = rawLabel.trim();
    let href = null;
    const [kind, id] = target.split(':');
    if (id && kind === 'deal' && dealIds.has(id)) href = `/deal/${id}`;
    else if (id && kind === 'business' && businessIds.has(id)) href = `/business/${id}`;
    else if (!id && SCREENS[kind] && (isOwner || !SCREENS[kind].owner)) href = SCREENS[kind].href;
    if (href) {
      seen.add(target);
      actions.push({ label: label || SCREENS[kind]?.label || 'Open', href });
    }
    return '';
  });

  return {
    reply: cleaned
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    actions,
  };
}

module.exports = { SCREENS, screenGuide, extractActions };
