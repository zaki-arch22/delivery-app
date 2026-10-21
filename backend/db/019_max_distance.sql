-- Maximum trip length (owner's wish, Oct 2026: the whole of Algeria may be one open zone, so the limit on how far one
-- delivery may go keeps every delivery local). Staff set it with the prices; existing price tables get the default.
ALTER TABLE pricing_rules ADD COLUMN max_km int NOT NULL DEFAULT 50 CHECK (max_km BETWEEN 1 AND 1000);
