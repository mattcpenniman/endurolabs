-- Apply only during the separately authorized rollout. No provider payloads or credentials.
BEGIN;
CREATE TABLE IF NOT EXISTS garmin_dynamics_backfill (
  activity_id uuid NOT NULL REFERENCES run_activities(id) ON DELETE CASCADE,
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'unavailable', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  sample_count integer,
  coverage jsonb,
  next_retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, version)
);
COMMIT;
