-- Preferred paid plan from Network application (user pays in-app after invite)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_membership_tier membership_tier;

COMMENT ON COLUMN profiles.preferred_membership_tier IS
  'Plan the member expressed interest in (Network apply). Cleared after Stripe subscription activates.';
