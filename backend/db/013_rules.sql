-- Rules engine (backend/docs/TRUST_AND_SAFETY.md): rule breaks with points, automatic TEMPORARY blocks, warnings, appeals,
-- bans by staff, and identifiers that a banned account cannot use again. Nothing here is ever deleted.

CREATE TABLE violations (
  id            bigserial PRIMARY KEY,
  profile_id    uuid NOT NULL REFERENCES profiles(id),
  rule          text NOT NULL CHECK (rule IN ('driver_released', 'late_cancel', 'not_ordered_refusal', 'far_confirmation', 'wrong_item',
                                              'damaged_by_driver', 'behaviour', 'prohibited_goods', 'other')),
  points        int  NOT NULL CHECK (points BETWEEN 0 AND 12),
  order_id      uuid REFERENCES orders(id),
  note          text CHECK (char_length(note) <= 500),           -- shown to the person: what happened
  source        text NOT NULL CHECK (source IN ('system', 'staff')),
  staff_id      uuid REFERENCES staff_users(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'appealed', 'upheld', 'cancelled')),
  appeal_text   text CHECK (char_length(appeal_text) <= 1000),
  appealed_at   timestamptz,
  decided_by    uuid REFERENCES staff_users(id),
  decision_note text CHECK (char_length(decision_note) <= 1000),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (source = 'system' OR staff_id IS NOT NULL)
);
-- The same rule is never counted twice for the same order (a repeated request or a retry adds nothing).
CREATE UNIQUE INDEX violations_once_per_order ON violations(profile_id, rule, order_id) WHERE order_id IS NOT NULL;
CREATE INDEX violations_profile ON violations(profile_id, created_at DESC);
CREATE INDEX violations_appealed ON violations(appealed_at) WHERE status = 'appealed';

-- A violation's facts never change; only its life moves forward: active -> appealed (once) -> upheld | cancelled, or
-- active -> cancelled by staff. It can never be deleted.
CREATE FUNCTION violations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'violations are permanent'; END IF;
  IF NEW.profile_id <> OLD.profile_id OR NEW.rule <> OLD.rule OR NEW.points <> OLD.points OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.source <> OLD.source OR NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the facts of a violation cannot change';
  END IF;
  IF OLD.appeal_text IS NOT NULL AND NEW.appeal_text IS DISTINCT FROM OLD.appeal_text THEN RAISE EXCEPTION 'an appeal cannot be changed'; END IF;
  IF NOT ((OLD.status = NEW.status AND NEW.status = 'active')
       OR (OLD.status = 'active' AND NEW.status = 'appealed' AND NEW.appeal_text IS NOT NULL)
       OR (OLD.status = 'active' AND NEW.status = 'cancelled' AND NEW.decided_by IS NOT NULL)
       OR (OLD.status = 'appealed' AND NEW.status IN ('upheld', 'cancelled') AND NEW.decided_by IS NOT NULL)) THEN
    RAISE EXCEPTION 'violation status cannot go from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER violations_guard_t BEFORE UPDATE OR DELETE ON violations FOR EACH ROW EXECUTE FUNCTION violations_guard();

-- Warnings, temporary blocks and bans. A block stops NEW work (new orders, going online, new offers); a job already
-- in progress can always be finished. A ban (staff only, a person's decision) closes the whole account.
CREATE TABLE sanctions (
  id            bigserial PRIMARY KEY,
  profile_id    uuid REFERENCES profiles(id),          -- warnings and blocks: one profile
  account_id    uuid REFERENCES accounts(id),          -- bans: the whole account
  kind          text NOT NULL CHECK (kind IN ('warning', 'block', 'ban')),
  level         int  CHECK (level IN (3, 5, 8, 12)),   -- the points threshold that triggered it (automatic ones)
  until         timestamptz,                           -- end of a block; NULL = until staff decide (block) / permanent (ban)
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  source        text NOT NULL CHECK (source IN ('system', 'staff')),
  staff_id      uuid REFERENCES staff_users(id),
  lifted_at     timestamptz,
  lifted_by     uuid REFERENCES staff_users(id),
  lift_note     text CHECK (char_length(lift_note) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'ban') = (account_id IS NOT NULL AND profile_id IS NULL)),
  CHECK (kind = 'ban' OR profile_id IS NOT NULL),
  CHECK (source = 'system' OR staff_id IS NOT NULL),
  CHECK (kind <> 'ban' OR source = 'staff')            -- only a person can ban
);
CREATE INDEX sanctions_profile ON sanctions(profile_id, created_at DESC) WHERE profile_id IS NOT NULL;
CREATE INDEX sanctions_account ON sanctions(account_id) WHERE account_id IS NOT NULL;
CREATE FUNCTION sanctions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sanctions are permanent (lift them instead)'; END IF;
  IF OLD.lifted_at IS NOT NULL THEN RAISE EXCEPTION 'a lifted sanction cannot change'; END IF;
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.kind <> OLD.kind OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.until IS DISTINCT FROM OLD.until OR NEW.reason <> OLD.reason OR NEW.source <> OLD.source OR NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only lifting can change a sanction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sanctions_guard_t BEFORE UPDATE OR DELETE ON sanctions FOR EACH ROW EXECUTE FUNCTION sanctions_guard();

-- What a banned account can never use again to make a new account. Only one-way fingerprints are stored.
CREATE TABLE banned_identifiers (
  kind        text NOT NULL CHECK (kind IN ('google', 'device', 'national_id', 'phone')),
  value_hash  text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id),
  sanction_id bigint NOT NULL REFERENCES sanctions(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value_hash)
);

-- The phones an account has used (fingerprints only), so a ban can cover them.
CREATE TABLE account_devices (
  account_id  uuid NOT NULL REFERENCES accounts(id),
  device_hash text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, device_hash)
);
CREATE INDEX account_devices_device ON account_devices(device_hash);

-- A driver's national ID number: one person = one driver profile. Stored as a fingerprint + last 3 digits for staff.
ALTER TABLE driver_details ADD COLUMN national_id_hash text UNIQUE, ADD COLUMN national_id_last3 text CHECK (national_id_last3 ~ '^\d{3}$');
-- The version of the platform rules the person accepted when creating the profile.
ALTER TABLE profiles ADD COLUMN rules_version int;
