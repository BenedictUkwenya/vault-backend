-- 045: VIP benefits — priority support queue and the monthly VIP giveaway.

-- Support/feedback queue: VIP messages are flagged priority and pinned for admins.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_check;
ALTER TABLE feedback ADD CONSTRAINT feedback_status_check CHECK (status IN ('open', 'resolved'));
CREATE INDEX IF NOT EXISTS feedback_queue_idx ON feedback (status, is_priority DESC, created_at DESC);

-- One draw per month. Every active VIP that month is an entrant.
CREATE TABLE IF NOT EXISTS vip_giveaways (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL UNIQUE,              -- 'YYYY-MM' (UTC)
  prize TEXT,
  winner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entrants INT NOT NULL DEFAULT 0,
  drawn_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Only the backend (service role) reads or writes giveaways.
ALTER TABLE vip_giveaways ENABLE ROW LEVEL SECURITY;
