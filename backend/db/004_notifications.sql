-- Notifications are written in the SAME transaction as the event that causes them (atomic).
-- A trigger sends a Postgres NOTIFY on insert; Postgres delivers NOTIFY only if the transaction COMMITS.
CREATE TABLE notifications (
  id            bigserial PRIMARY KEY,
  profile_id    uuid NOT NULL REFERENCES profiles(id),     -- always ONE profile, never the account
  type          text NOT NULL,
  order_id      uuid REFERENCES orders(id),
  data          jsonb NOT NULL DEFAULT '{}',
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  dedupe_key    text NOT NULL,
  expires_at    timestamptz,                               -- e.g. an offer is useless after it expires
  created_at    timestamptz NOT NULL DEFAULT now(),
  push_state    text NOT NULL DEFAULT 'pending' CHECK (push_state IN ('pending','sent','skipped','failed')),
  push_attempts int NOT NULL DEFAULT 0,
  push_next_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, dedupe_key)                          -- the same event can never notify twice
);
CREATE INDEX notifications_profile ON notifications(profile_id, id);
CREATE INDEX notifications_push    ON notifications(push_next_at) WHERE push_state = 'pending';

CREATE FUNCTION notifications_notify() RETURNS trigger AS $$
BEGIN PERFORM pg_notify('notif', NEW.id::text); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER notifications_notify_t AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notifications_notify();

-- A phone's push token belongs to the ACTIVE profile of its session. Switching profile moves it.
CREATE TABLE device_tokens (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  platform   text NOT NULL CHECK (platform IN ('android','ios')),
  language   text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar','fr')),
  token      text NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_profile ON device_tokens(profile_id);

-- SMS to people without an account (the recipient's delivery code): saved with the order, sent with retries.
CREATE TABLE sms_outbox (
  id              bigserial PRIMARY KEY,
  phone           text NOT NULL,
  body            text NOT NULL,
  kind            text NOT NULL,
  state           text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX sms_outbox_due ON sms_outbox(next_attempt_at) WHERE state = 'pending';
