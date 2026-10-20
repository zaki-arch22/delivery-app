-- The receiver no longer confirms before couriers are searched (owner's decision, Oct 2026): orders search at once.
-- Orders still waiting for a receiver's answer start searching now. (The enum value stays: PostgreSQL cannot drop it,
-- and no code uses it any more.)
UPDATE orders SET status='searching', search_started_at=now() WHERE status='awaiting_recipient';
ALTER TABLE orders DROP COLUMN recipient_answer, DROP COLUMN recipient_answered_at;
