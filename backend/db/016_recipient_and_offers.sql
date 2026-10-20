-- 1) The receiver confirms first (owner's wish, Oct 2026). Couriers are searched only after "yes".
ALTER TABLE orders ADD COLUMN recipient_answer text CHECK (recipient_answer IN ('confirmed', 'declined')),
                   ADD COLUMN recipient_answered_at timestamptz,
                   ADD COLUMN auto_accept boolean NOT NULL DEFAULT false,   -- "take the first courier who accepts my price"
                   ADD COLUMN route_line jsonb;                              -- the road line for the map (null = straight line)

-- 2) Courier offers, inDrive style: a request is shown to several nearby couriers at once; each may accept the customer's
--    price or propose a higher one (never above the staff maximum); the customer chooses. The price locks at that moment.
ALTER TABLE offers ADD COLUMN bid_da int CHECK (bid_da > 0),
                   ADD COLUMN bid_at timestamptz,
                   ADD COLUMN bid_expires_at timestamptz,
                   ADD COLUMN eta_s int CHECK (eta_s >= 0),
                   ADD CONSTRAINT bid_complete CHECK (status <> 'bid' OR (bid_da IS NOT NULL AND bid_expires_at IS NOT NULL));
-- A courier waits for ONE customer's answer at a time (he can only do one job at a time anyway).
CREATE UNIQUE INDEX one_open_bid_per_driver ON offers(driver_profile_id) WHERE status = 'bid';

-- 3) Money rule kept by the database: the locked price is always inside the order's allowed range.
ALTER TABLE orders ADD CONSTRAINT locked_in_range CHECK (locked_da IS NULL OR locked_da BETWEEN min_da AND max_da);
