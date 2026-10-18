-- Quotes: a price offer the app got from get_quote, valid for 5 minutes, usable once by its owner.
CREATE TABLE quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id uuid NOT NULL REFERENCES profiles(id),
  data            jsonb NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- A driver can hold only ONE active job at a time. The database guarantees it, even under simultaneous accepts.
CREATE UNIQUE INDEX one_active_job_per_driver ON orders(driver_profile_id) WHERE status IN ('assigned','picked_up');
CREATE INDEX offers_open ON offers(order_id) WHERE status = 'offered';
