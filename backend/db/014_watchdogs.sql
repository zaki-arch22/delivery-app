-- Phase 3 safety nets (TRUST_AND_SAFETY.md): evidence photos on problem reports, emergencies, weekly driver selfies.
-- Problem reports may carry up to 3 evidence photos (documents tied to the order).
ALTER TABLE problem_reports ADD COLUMN photos uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 3);
-- An emergency can happen without an order (a driver alone on the road): then the report has no order.
ALTER TABLE problem_reports ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE problem_reports ADD CONSTRAINT problem_order_or_emergency CHECK (order_id IS NOT NULL OR reason = 'emergency');
-- A driver's selfie (before going online, at most every 7 days) is a document tied to his driver profile.
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('id_photo', 'licence_photo', 'vehicle_photo', 'parcel_photo', 'evidence_photo', 'selfie_photo'));
CREATE INDEX documents_selfies ON documents(profile_id, created_at DESC) WHERE kind = 'selfie_photo';
