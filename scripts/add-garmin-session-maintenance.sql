-- Apply before deploying the session-maintenance worker/app.
ALTER TABLE garmin_connections ADD COLUMN IF NOT EXISTS next_token_check_at timestamp;
CREATE INDEX IF NOT EXISTS garmin_connections_token_check_idx
  ON garmin_connections (next_token_check_at, id) WHERE status = 'connected';
