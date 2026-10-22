-- The money system (owner's decision, Oct 2026). The platform never holds customers' money:
--   * the delivery fee is paid in cash to the courier (by the sender or the receiver);
--   * the goods money (cash on delivery) goes from the receiver, through the courier, STRAIGHT to the seller's
--     BaridiMob/CCP account (or by hand) within 24 hours, and both sides confirm in the app;
--   * the platform's 10% commission comes out of each courier's prepaid wallet, topped up by transfer to the platform's
--     CCP account. The platform does not compensate anyone; every step is proved and kept forever.

-- 1. Where a person receives money: their Algérie Poste account (RIP, 20 digits: 007 99999 + CCP account + key),
--    the one BaridiMob uses. One per account (the same person, whether sending or delivering).
CREATE TABLE payout_accounts (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id),
  rip         text NOT NULL CHECK (rip ~ '^00799999[0-9]{12}$'),
  holder_name text NOT NULL CHECK (char_length(holder_name) BETWEEN 3 AND 80),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Each cash-on-delivery order: the seller's account is copied onto the order when it is created, so a later change
--    of account can never redirect money already on its way. The commission is written when the order is delivered.
ALTER TABLE orders ADD COLUMN cod_rip text, ADD COLUMN cod_holder text, ADD COLUMN commission_da int CHECK (commission_da >= 0);
ALTER TABLE pricing_rules ADD COLUMN commission_percent int NOT NULL DEFAULT 10 CHECK (commission_percent BETWEEN 0 AND 50);

-- 3. Goods money owed by a courier to a seller after a delivery: pending -> sent (courier: reference + receipt photo, or
--    "by hand") -> confirmed (seller). The seller may dispute; staff resolve with the proofs. Every step also goes into
--    the order's permanent history (order_events).
CREATE TABLE cod_settlements (
  order_id          uuid PRIMARY KEY REFERENCES orders(id),
  driver_profile_id uuid NOT NULL REFERENCES profiles(id),
  seller_profile_id uuid NOT NULL REFERENCES profiles(id),
  amount_da         int  NOT NULL CHECK (amount_da > 0),
  seller_rip        text NOT NULL,
  seller_holder     text NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'confirmed', 'disputed', 'resolved_paid', 'resolved_unpaid')),
  due_at            timestamptz NOT NULL,
  method            text CHECK (method IN ('baridimob', 'cash')),
  reference         text CHECK (char_length(reference) BETWEEN 4 AND 40),
  receipt_doc       uuid REFERENCES documents(id),
  sent_at           timestamptz,
  confirmed_at      timestamptz,
  dispute_note      text CHECK (char_length(dispute_note) <= 500),
  disputed_at       timestamptz,
  resolved_by       uuid REFERENCES staff_users(id),
  resolution_note   text CHECK (char_length(resolution_note) <= 500),
  resolved_at       timestamptz,
  overdue_at        timestamptz,              -- set once when the 24 hours passed without the money being sent
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'sent' OR (method IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (method <> 'baridimob' OR (reference IS NOT NULL AND receipt_doc IS NOT NULL))
);
CREATE INDEX cod_settlements_driver ON cod_settlements(driver_profile_id, status);
CREATE INDEX cod_settlements_seller ON cod_settlements(seller_profile_id, status);
CREATE INDEX cod_settlements_due ON cod_settlements(due_at) WHERE status = 'pending';

-- The courier's cash ledger also records the goods money passed on to the seller (a minus entry, once per order).
DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'cash_ledger'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%cod_collected%';
  EXECUTE format('ALTER TABLE cash_ledger DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE cash_ledger ADD CONSTRAINT cash_ledger_kind CHECK (
     (type = 'cod_collected'  AND amount_da > 0 AND order_id IS NOT NULL)
  OR (type = 'paid_to_seller' AND amount_da < 0 AND order_id IS NOT NULL)
  OR (type = 'handover'       AND amount_da < 0 AND staff_id IS NOT NULL)
  OR (type = 'adjustment'     AND staff_id IS NOT NULL AND note IS NOT NULL));
CREATE UNIQUE INDEX one_seller_payment_per_order ON cash_ledger(order_id) WHERE type = 'paid_to_seller';

-- 4. The courier's prepaid wallet (the platform's commission). Top-ups are requested with the transfer reference and a
--    photo of the receipt, and become money only when a staff member approves them.
CREATE TABLE wallet_topups (
  id                bigserial PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES profiles(id),
  amount_da         int  NOT NULL CHECK (amount_da BETWEEN 100 AND 200000),
  reference         text NOT NULL CHECK (char_length(reference) BETWEEN 4 AND 40),
  receipt_doc       uuid NOT NULL REFERENCES documents(id),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by        uuid REFERENCES staff_users(id),
  decided_at        timestamptz,
  reason            text CHECK (char_length(reason) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wallet_topup_reference ON wallet_topups(reference) WHERE status <> 'rejected';   -- one transfer, one top-up
CREATE TABLE wallet_ledger (
  id                bigserial PRIMARY KEY,
  driver_profile_id uuid NOT NULL REFERENCES profiles(id),
  type              text NOT NULL CHECK (type IN ('topup', 'commission', 'adjustment')),
  amount_da         int  NOT NULL CHECK (amount_da <> 0),
  order_id          uuid REFERENCES orders(id),
  topup_id          bigint REFERENCES wallet_topups(id),
  staff_id          uuid REFERENCES staff_users(id),
  note              text CHECK (char_length(note) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'commission' AND amount_da < 0 AND order_id IS NOT NULL)
      OR (type = 'topup' AND amount_da > 0 AND topup_id IS NOT NULL)
      OR (type = 'adjustment' AND staff_id IS NOT NULL AND note IS NOT NULL))
);
CREATE UNIQUE INDEX one_commission_per_order ON wallet_ledger(order_id) WHERE type = 'commission';
CREATE UNIQUE INDEX one_entry_per_topup ON wallet_ledger(topup_id) WHERE type = 'topup';
CREATE INDEX wallet_ledger_driver ON wallet_ledger(driver_profile_id, id);

-- 5. Receipt photos (BaridiMob transfers) are kept like the other proofs; a late money transfer is a rule break.
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('id_photo', 'licence_photo', 'vehicle_photo', 'ownership_photo', 'parcel_photo', 'evidence_photo', 'selfie_photo', 'transfer_receipt'));
ALTER TABLE violations DROP CONSTRAINT violations_rule_check;
ALTER TABLE violations ADD CONSTRAINT violations_rule_check CHECK (rule IN ('driver_released', 'late_cancel', 'not_ordered_refusal', 'far_confirmation', 'wrong_item',
  'damaged_by_driver', 'behaviour', 'prohibited_goods', 'other', 'cod_late'));
