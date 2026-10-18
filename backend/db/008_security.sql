-- Security: permanent security event log, session theft detection, mandatory two-factor for staff, SMS abuse caps.
CREATE TABLE security_events (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  ip         text,
  account_id uuid,
  staff_id   uuid,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_type_time ON security_events(type, created_at DESC);
CREATE INDEX security_events_ip_time   ON security_events(ip, created_at DESC);
CREATE TRIGGER security_events_append_only BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE otp_codes ADD COLUMN ip text;
CREATE INDEX otp_ip_time ON otp_codes(ip, created_at DESC);

-- Refresh tokens rotate on every use. The previous one is remembered: if it is ever presented again, someone copied it, and the whole session is killed.
ALTER TABLE sessions ADD COLUMN prev_refresh_hash text, ADD COLUMN last_ip text;
CREATE INDEX sessions_prev_refresh ON sessions(prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;
CREATE INDEX sessions_account ON sessions(account_id) WHERE NOT revoked;

-- Staff: authenticator-app code (TOTP) is mandatory. The secret is stored ENCRYPTED, so a copy of the database alone does not give an attacker the second factor.
ALTER TABLE staff_users ADD COLUMN totp_secret_sealed text, ADD COLUMN totp_last_step bigint NOT NULL DEFAULT 0, ADD COLUMN token_version int NOT NULL DEFAULT 0;
