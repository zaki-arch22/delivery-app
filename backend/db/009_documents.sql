-- Driver document photos (ID, licence, vehicle). The image files live on the server's private disk (UPLOAD_DIR), never in a
-- web folder; this table records who uploaded each one and which driver profile uses it. Staff see them only through the API.
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  kind        text NOT NULL CHECK (kind IN ('id_photo', 'licence_photo', 'vehicle_photo')),
  size_bytes  int  NOT NULL CHECK (size_bytes > 0),
  sha256      text NOT NULL,
  profile_id  uuid REFERENCES profiles(id),   -- set when a driver profile is created with it; NULL = not used yet (deleted after a day)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_account_unused ON documents(account_id) WHERE profile_id IS NULL;
CREATE INDEX documents_unused_age ON documents(created_at) WHERE profile_id IS NULL;

-- A document used by a driver profile can never be moved to another profile or deleted (proof for the approval decision).
CREATE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.profile_id IS NOT NULL THEN RAISE EXCEPTION 'a document used by a driver profile cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.profile_id IS NOT NULL OR NEW.account_id <> OLD.account_id OR NEW.kind <> OLD.kind OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes THEN
    RAISE EXCEPTION 'a document can only be attached once, to a profile';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard();

-- Driver details point to uploaded documents instead of free-text links.
ALTER TABLE driver_details
  ADD COLUMN id_photo_doc      uuid REFERENCES documents(id),
  ADD COLUMN licence_photo_doc uuid REFERENCES documents(id),
  ADD COLUMN vehicle_photo_doc uuid REFERENCES documents(id),
  DROP COLUMN id_photo_url, DROP COLUMN licence_photo_url, DROP COLUMN vehicle_photo_url;
-- Every NEW driver must have the three documents (NOT VALID: checked for new and changed rows).
ALTER TABLE driver_details ADD CONSTRAINT driver_documents_required
  CHECK (id_photo_doc IS NOT NULL AND licence_photo_doc IS NOT NULL AND vehicle_photo_doc IS NOT NULL) NOT VALID;
