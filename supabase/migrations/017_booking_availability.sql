-- Booking availability: weekly templates, date blocks, and one active hold per slot

CREATE TABLE IF NOT EXISTS business_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  slot_time TEXT NOT NULL CHECK (slot_time ~ '^\d{2}:\d{2}$'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, weekday, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_business_availability_biz
  ON business_availability(business_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS business_availability_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, blocked_date)
);

CREATE INDEX IF NOT EXISTS idx_business_availability_blocks_biz
  ON business_availability_blocks(business_id, blocked_date);

-- Only one pending/approved booking may hold a given business/date/time slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
  ON bookings (business_id, preferred_date, preferred_time)
  WHERE status IN ('pending', 'approved');
