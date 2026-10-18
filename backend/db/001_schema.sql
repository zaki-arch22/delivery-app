-- Delivery platform: database schema v1 (PostgreSQL 16 + PostGIS)
-- Money is stored as whole Algerian dinars (integer DA). No decimals anywhere.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE profile_type   AS ENUM ('user','driver');
CREATE TYPE profile_status AS ENUM ('active','pending_approval','rejected','suspended');
CREATE TYPE vehicle_type   AS ENUM ('motorbike','car');
CREATE TYPE parcel_size    AS ENUM ('small','medium','large');
CREATE TYPE payer_type     AS ENUM ('sender','recipient');
CREATE TYPE leg_type       AS ENUM ('delivery','return');
CREATE TYPE order_status   AS ENUM ('searching','assigned','picked_up','delivered','failed','cancelled','expired');
CREATE TYPE offer_status   AS ENUM ('offered','accepted','declined','expired');
CREATE TYPE ledger_type    AS ENUM ('cod_collected','handover','adjustment');
CREATE TYPE problem_status AS ENUM ('open','in_progress','resolved');

-- One phone number = one account. Login identity only.
CREATE TABLE accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL UNIQUE CHECK (phone ~ '^\+[0-9]{8,15}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id         bigserial PRIMARY KEY,
  phone      text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  consumed   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes(phone, created_at DESC);

-- Up to two independent profiles per account: one 'user', one 'driver'.
CREATE TABLE profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  type         profile_type NOT NULL,
  display_name text NOT NULL,
  photo_url    text,
  status       profile_status NOT NULL,
  rating_sum   int NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, type)
);

CREATE TABLE driver_details (
  profile_id        uuid PRIMARY KEY REFERENCES profiles(id),
  id_photo_url      text NOT NULL,
  licence_photo_url text NOT NULL,
  vehicle           vehicle_type NOT NULL,
  vehicle_photo_url text NOT NULL,
  is_online         boolean NOT NULL DEFAULT false,
  last_location     geography(Point,4326),
  last_location_at  timestamptz,
  cash_limit_da     int,                 -- set by staff; NULL = no cash orders yet
  approved_by       uuid,
  approved_at       timestamptz
);
CREATE INDEX driver_online_geo ON driver_details USING gist(last_location) WHERE is_online;

CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  active_profile_id uuid REFERENCES profiles(id),   -- NULL until the account creates its first profile
  refresh_hash      text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  revoked           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true
);

-- Zones: staff open/close areas. An order is accepted only if pickup AND drop-off are inside open zones.
CREATE TABLE zones (
  id      serial PRIMARY KEY,
  name    text NOT NULL UNIQUE,
  area    geography(MultiPolygon,4326) NOT NULL,
  is_open boolean NOT NULL DEFAULT false
);
CREATE INDEX zones_area ON zones USING gist(area);

-- Price table, versioned. Staff create a new version; old orders keep theirs.
CREATE TABLE pricing_rules (
  version         serial PRIMARY KEY,
  base_da         int NOT NULL CHECK (base_da >= 0),
  per_km_da       int NOT NULL CHECK (per_km_da >= 0),
  medium_extra_da int NOT NULL DEFAULT 0,
  large_extra_da  int NOT NULL DEFAULT 0,
  car_extra_da    int NOT NULL DEFAULT 0,
  min_percent     int NOT NULL CHECK (min_percent BETWEEN 1 AND 100),   -- lowest allowed offer, % of recommended
  max_percent     int NOT NULL CHECK (max_percent >= 100),              -- highest allowed offer
  active          boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_pricing ON pricing_rules(active) WHERE active;

CREATE SEQUENCE order_ref_seq START 100000;

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text NOT NULL UNIQUE DEFAULT ('D' || nextval('order_ref_seq')),
  leg              leg_type NOT NULL DEFAULT 'delivery',
  parent_order_id  uuid REFERENCES orders(id),
  user_profile_id  uuid NOT NULL REFERENCES profiles(id),
  driver_profile_id uuid REFERENCES profiles(id),
  status           order_status NOT NULL DEFAULT 'searching',
  pickup_point     geography(Point,4326) NOT NULL,
  pickup_address   jsonb NOT NULL,         -- street, entrance, floor, landmark (snapshot, never edited)
  dropoff_point    geography(Point,4326) NOT NULL,
  dropoff_address  jsonb NOT NULL,
  recipient_name   text NOT NULL,
  recipient_phone  text NOT NULL CHECK (recipient_phone ~ '^\+[0-9]{8,15}$'),
  size             parcel_size NOT NULL,
  vehicle          vehicle_type NOT NULL,
  payer            payer_type NOT NULL,
  cod_amount_da    int NOT NULL DEFAULT 0 CHECK (cod_amount_da >= 0),
  pricing_version  int NOT NULL REFERENCES pricing_rules(version),
  distance_m       int NOT NULL,
  duration_s       int NOT NULL,
  recommended_da   int NOT NULL,
  min_da           int NOT NULL,
  max_da           int NOT NULL,
  offered_da       int NOT NULL,           -- price the user chose
  locked_da        int,                    -- set when a driver accepts; never changes after
  delivery_code    text NOT NULL,          -- 4 digits, shown to the user, sent to recipient by SMS
  idempotency_key  text NOT NULL,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  assigned_at      timestamptz,
  picked_up_at     timestamptz,
  delivered_at     timestamptz,
  CHECK (offered_da BETWEEN min_da AND max_da),
  CHECK (locked_da IS NULL OR driver_profile_id IS NOT NULL),
  UNIQUE (user_profile_id, idempotency_key)
);
CREATE INDEX orders_user   ON orders(user_profile_id, created_at DESC);
CREATE INDEX orders_driver ON orders(driver_profile_id, created_at DESC);
CREATE INDEX orders_open   ON orders(status) WHERE status IN ('searching','assigned','picked_up');

CREATE TABLE offers (
  id                bigserial PRIMARY KEY,
  order_id          uuid NOT NULL REFERENCES orders(id),
  driver_profile_id uuid NOT NULL REFERENCES profiles(id),
  status            offer_status NOT NULL DEFAULT 'offered',
  rank              int NOT NULL,
  offered_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  UNIQUE (order_id, driver_profile_id)
);
CREATE INDEX offers_driver ON offers(driver_profile_id, status);

-- Append-only history of everything that happens to an order.
CREATE TABLE order_events (
  id               bigserial PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES orders(id),
  type             text NOT NULL,
  actor_profile_id uuid REFERENCES profiles(id),
  actor_staff_id   uuid REFERENCES staff_users(id),
  data             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events(order_id, id);

CREATE TABLE ratings (
  id               bigserial PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES orders(id),
  rater_profile_id uuid NOT NULL REFERENCES profiles(id),
  rated_profile_id uuid NOT NULL REFERENCES profiles(id),
  stars            int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment          text CHECK (char_length(comment) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, rater_profile_id),
  CHECK (rater_profile_id <> rated_profile_id)
);

-- Permanent cash ledger. Balance = SUM(amount_da). Corrections are new rows.
CREATE TABLE cash_ledger (
  id                bigserial PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES profiles(id),
  order_id          uuid REFERENCES orders(id),
  type              ledger_type NOT NULL,
  amount_da         int NOT NULL CHECK (amount_da <> 0),   -- + cash taken in, - cash handed over
  reverses_id       bigint REFERENCES cash_ledger(id),
  note              text,
  staff_id          uuid REFERENCES staff_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'cod_collected' AND amount_da > 0 AND order_id IS NOT NULL)
      OR (type = 'handover'      AND amount_da < 0 AND staff_id IS NOT NULL)
      OR (type = 'adjustment'    AND staff_id IS NOT NULL AND note IS NOT NULL))
);
CREATE UNIQUE INDEX one_cod_entry_per_order ON cash_ledger(order_id) WHERE type = 'cod_collected';
CREATE INDEX ledger_driver ON cash_ledger(driver_profile_id);

CREATE TABLE problem_reports (
  id                  bigserial PRIMARY KEY,
  order_id            uuid NOT NULL REFERENCES orders(id),
  reporter_profile_id uuid NOT NULL REFERENCES profiles(id),
  reason              text NOT NULL,
  note                text CHECK (char_length(note) <= 1000),
  status              problem_status NOT NULL DEFAULT 'open',
  handled_by          uuid REFERENCES staff_users(id),
  resolution          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);

-- ============ Rules enforced by the database itself ============

-- 1) order.user_profile_id must be a 'user' profile; driver_profile_id a 'driver' profile that is active;
--    and a driver can NEVER take an order created by the user profile of the same account.
CREATE FUNCTION orders_guard() RETURNS trigger AS $$
DECLARE u profiles%ROWTYPE; d profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM profiles WHERE id = NEW.user_profile_id;
  IF u.type <> 'user' THEN RAISE EXCEPTION 'order owner must be a user profile'; END IF;
  IF NEW.driver_profile_id IS NOT NULL THEN
    SELECT * INTO d FROM profiles WHERE id = NEW.driver_profile_id;
    IF d.type <> 'driver' THEN RAISE EXCEPTION 'courier must be a driver profile'; END IF;
    IF d.account_id = u.account_id THEN RAISE EXCEPTION 'same account cannot deliver its own order'; END IF;
  END IF;
  -- the locked price can be set once and never changed
  IF TG_OP = 'UPDATE' AND OLD.locked_da IS NOT NULL AND NEW.locked_da IS DISTINCT FROM OLD.locked_da THEN
    RAISE EXCEPTION 'locked price cannot change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER orders_guard_t BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_guard();

-- 2) offers: same account rule
CREATE FUNCTION offers_guard() RETURNS trigger AS $$
DECLARE u_acc uuid; d_acc uuid; d_type profile_type;
BEGIN
  SELECT p.account_id INTO u_acc FROM orders o JOIN profiles p ON p.id=o.user_profile_id WHERE o.id=NEW.order_id;
  SELECT account_id, type INTO d_acc, d_type FROM profiles WHERE id=NEW.driver_profile_id;
  IF d_type <> 'driver' THEN RAISE EXCEPTION 'offers go to driver profiles only'; END IF;
  IF d_acc = u_acc THEN RAISE EXCEPTION 'same account cannot receive its own order'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER offers_guard_t BEFORE INSERT ON offers FOR EACH ROW EXECUTE FUNCTION offers_guard();

-- 3) a rating must be between the two real parties of a delivered order
CREATE FUNCTION ratings_guard() RETURNS trigger AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM orders WHERE id = NEW.order_id;
  IF o.status <> 'delivered' THEN RAISE EXCEPTION 'only delivered orders can be rated'; END IF;
  IF NOT ((NEW.rater_profile_id = o.user_profile_id AND NEW.rated_profile_id = o.driver_profile_id)
       OR (NEW.rater_profile_id = o.driver_profile_id AND NEW.rated_profile_id = o.user_profile_id)) THEN
    RAISE EXCEPTION 'rating must be between the order''s user and driver';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ratings_guard_t BEFORE INSERT ON ratings FOR EACH ROW EXECUTE FUNCTION ratings_guard();

CREATE FUNCTION ratings_apply() RETURNS trigger AS $$
BEGIN
  UPDATE profiles SET rating_sum = rating_sum + NEW.stars, rating_count = rating_count + 1 WHERE id = NEW.rated_profile_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ratings_apply_t AFTER INSERT ON ratings FOR EACH ROW EXECUTE FUNCTION ratings_apply();

-- 4) append-only tables: no UPDATE or DELETE ever
CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON cash_ledger  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER ratings_append_only BEFORE UPDATE OR DELETE ON ratings     FOR EACH ROW EXECUTE FUNCTION forbid_change();
