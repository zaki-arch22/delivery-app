-- Staff alerts (owner's wish, Oct 2026): only important things (SOS, reports, checks, disputes, late seller payments, work
-- waiting for a decision). When a staff member opens the alerts, they are marked seen for him (on every device).
ALTER TABLE staff_users ADD COLUMN alerts_seen_at timestamptz NOT NULL DEFAULT now();
