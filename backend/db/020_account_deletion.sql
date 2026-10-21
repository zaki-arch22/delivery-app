-- "Delete my account" (required by Google Play and Apple). The account and its profiles are emptied of personal data and
-- can never log in again; the history that protects other people (orders, cash ledger, ratings, the trust history) stays,
-- without the person's name, phone, Google link, ID number or document photos.
ALTER TYPE profile_status ADD VALUE IF NOT EXISTS 'deleted';
ALTER TABLE accounts ADD COLUMN deleted_at timestamptz;
ALTER TABLE accounts DROP CONSTRAINT account_identity;
ALTER TABLE accounts ADD CONSTRAINT account_identity CHECK (deleted_at IS NOT NULL OR google_sub IS NOT NULL OR (phone IS NOT NULL AND phone_verified));
