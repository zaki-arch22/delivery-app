-- New ledger entry type for the money system (its own file: a new enum value cannot be used in the same transaction).
ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'paid_to_seller';
