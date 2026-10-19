-- Login with Google (free) while there is no SMS provider. One Google account = one account.
-- The phone number of a Google account is typed by the person and NOT verified (no SMS yet): it is a contact number only,
-- so it is not unique and never used to find a person (e.g. incoming-parcel pushes go to VERIFIED numbers only).
ALTER TABLE accounts
  ADD COLUMN google_sub text UNIQUE CHECK (google_sub ~ '^[0-9A-Za-z_-]{1,255}$'),
  ADD COLUMN phone_verified boolean NOT NULL DEFAULT true;
ALTER TABLE accounts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE accounts DROP CONSTRAINT accounts_phone_key;
CREATE UNIQUE INDEX accounts_verified_phone ON accounts(phone) WHERE phone_verified;
-- Every account is either a verified phone number (SMS login) or a Google account.
ALTER TABLE accounts ADD CONSTRAINT account_identity CHECK (google_sub IS NOT NULL OR (phone IS NOT NULL AND phone_verified));
