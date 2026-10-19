-- Proof chain (backend/docs/TRUST_AND_SAFETY.md): every handover is proved by two people and recorded.
ALTER TABLE orders
  ADD COLUMN pickup_code            text CHECK (pickup_code ~ '^\d{4}$'),    -- shown to the SENDER; the driver must enter/scan it at pickup (NULL = return legs and older orders)
  ADD COLUMN pickup_attempts        int  NOT NULL DEFAULT 0,
  ADD COLUMN inspection             text NOT NULL DEFAULT 'outside' CHECK (inspection IN ('outside','open')),   -- may the receiver open the parcel before paying?
  ADD COLUMN tracking_hash          text UNIQUE,                             -- one-way fingerprint of the receiver's secret tracking link
  ADD COLUMN recipient_expecting_at timestamptz,                             -- the receiver pressed "I am expecting this parcel"
  ADD COLUMN pickup_photo_doc       uuid,
  ADD COLUMN pickup_distance_m      int,                                     -- driver's distance from the pickup point when confirming pickup
  ADD COLUMN delivery_distance_m    int,                                     -- ... from the drop-off point when confirming delivery
  ADD COLUMN ended_at               timestamptz;                             -- delivered, failed, cancelled or expired (the tracking link ends 24 h later)

-- Parcel photos (at pickup) and evidence photos (refusals, problems) are documents tied to an ORDER, never changed afterwards.
ALTER TABLE documents ADD COLUMN order_id uuid REFERENCES orders(id);
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('id_photo', 'licence_photo', 'vehicle_photo', 'parcel_photo', 'evidence_photo'));
ALTER TABLE documents ADD CONSTRAINT documents_one_owner CHECK (profile_id IS NULL OR order_id IS NULL);
ALTER TABLE orders ADD CONSTRAINT orders_pickup_photo_fk FOREIGN KEY (pickup_photo_doc) REFERENCES documents(id);
DROP INDEX documents_account_unused; DROP INDEX documents_unused_age;
CREATE INDEX documents_account_unused ON documents(account_id) WHERE profile_id IS NULL AND order_id IS NULL;
CREATE INDEX documents_unused_age ON documents(created_at) WHERE profile_id IS NULL AND order_id IS NULL;
CREATE INDEX documents_order ON documents(order_id) WHERE order_id IS NOT NULL;
CREATE OR REPLACE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.profile_id IS NOT NULL OR OLD.order_id IS NOT NULL THEN RAISE EXCEPTION 'a document in use cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.profile_id IS NOT NULL OR OLD.order_id IS NOT NULL OR NEW.account_id <> OLD.account_id OR NEW.kind <> OLD.kind OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes THEN
    RAISE EXCEPTION 'a document can only be attached once';
  END IF;
  RETURN NEW;
END $$;

-- Problems can also come from the receiver (tracking page, no account) or from the system itself (automatic checks).
ALTER TABLE problem_reports ALTER COLUMN reporter_profile_id DROP NOT NULL;
ALTER TABLE problem_reports ADD COLUMN reporter_kind text NOT NULL DEFAULT 'profile' CHECK (reporter_kind IN ('profile', 'recipient', 'system'));
ALTER TABLE problem_reports ADD CONSTRAINT problem_reporter CHECK ((reporter_kind = 'profile') = (reporter_profile_id IS NOT NULL));

-- When an order ends, remember when (set once, by the database itself, whatever code path ended it).
CREATE FUNCTION orders_ended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('delivered','failed','cancelled','expired') AND OLD.status NOT IN ('delivered','failed','cancelled','expired') THEN NEW.ended_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_ended_t BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION orders_ended();
