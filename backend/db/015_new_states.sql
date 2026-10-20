-- New states (PostgreSQL needs new enum values committed before they can be used, so they get their own file).
-- awaiting_recipient: the order waits for the receiver to say "yes, I expect this parcel" before couriers are searched.
-- bid: a courier answered a request with a price (the customer's price or a higher one) and waits for the customer's choice.
-- rejected: the customer said no to that courier's price.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting_recipient' BEFORE 'searching';
ALTER TYPE offer_status ADD VALUE IF NOT EXISTS 'bid';
ALTER TYPE offer_status ADD VALUE IF NOT EXISTS 'rejected';
