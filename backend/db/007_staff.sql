-- Staff: login lockout, a permanent audit trail of every staff action, and rules for staff interventions.
ALTER TABLE staff_users ADD COLUMN failed_attempts int NOT NULL DEFAULT 0, ADD COLUMN locked_until timestamptz;

CREATE TABLE staff_audit (
  id          bigserial PRIMARY KEY,
  staff_id    uuid NOT NULL REFERENCES staff_users(id),
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_target ON staff_audit(target_type, target_id);
CREATE TRIGGER staff_audit_append_only BEFORE UPDATE OR DELETE ON staff_audit FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- When staff reassign an order, the search restarts from now (its own clock), not from the order's creation.
ALTER TABLE orders ADD COLUMN search_started_at timestamptz NOT NULL DEFAULT now();

-- A locked price still cannot be changed, EXCEPT that a staff reassignment releases the lock (the next driver locks it again).
CREATE OR REPLACE FUNCTION orders_guard() RETURNS trigger AS $$
DECLARE u profiles%ROWTYPE; d profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM profiles WHERE id = NEW.user_profile_id;
  IF u.type <> 'user' THEN RAISE EXCEPTION 'order owner must be a user profile'; END IF;
  IF NEW.driver_profile_id IS NOT NULL THEN
    SELECT * INTO d FROM profiles WHERE id = NEW.driver_profile_id;
    IF d.type <> 'driver' THEN RAISE EXCEPTION 'courier must be a driver profile'; END IF;
    IF d.account_id = u.account_id THEN RAISE EXCEPTION 'same account cannot deliver its own order'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.locked_da IS NOT NULL AND NEW.locked_da IS DISTINCT FROM OLD.locked_da
     AND NOT (NEW.locked_da IS NULL AND NEW.status = 'searching' AND OLD.status = 'assigned') THEN
    RAISE EXCEPTION 'locked price cannot change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- A cash entry can be reversed only once.
CREATE UNIQUE INDEX one_reversal_per_entry ON cash_ledger(reverses_id) WHERE reverses_id IS NOT NULL;
