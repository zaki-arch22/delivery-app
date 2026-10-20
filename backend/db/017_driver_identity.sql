-- Driver sign-up (owner's list, Oct 2026): who he is (first and last name, date of birth), his vehicle (type, colour,
-- plate) and his documents (ID card, driving licence, proof he owns the vehicle, vehicle photos with the plate).
-- Everything is checked by a person (staff) before he can work: nothing is approved automatically.
ALTER TABLE driver_details
  ADD COLUMN first_name          text CHECK (char_length(first_name) BETWEEN 1 AND 40),
  ADD COLUMN last_name           text CHECK (char_length(last_name) BETWEEN 1 AND 40),
  ADD COLUMN birth_date          date,
  ADD COLUMN vehicle_color       text CHECK (char_length(vehicle_color) BETWEEN 2 AND 30),
  ADD COLUMN plate_number        text CHECK (plate_number ~ '^[0-9A-Z][0-9A-Z -]{4,18}[0-9A-Z]$'),
  ADD COLUMN ownership_photo_doc uuid REFERENCES documents(id);
ALTER TABLE documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_kind_check CHECK (kind IN ('id_photo', 'licence_photo', 'vehicle_photo', 'ownership_photo', 'parcel_photo', 'evidence_photo', 'selfie_photo'));
