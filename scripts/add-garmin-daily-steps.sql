-- Apply before deploying daily steps support. No Garmin calls or historical writes.
CREATE TABLE IF NOT EXISTS garmin_daily_steps (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date varchar(10) NOT NULL,
  total_steps integer,
  fetched_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date),
  CONSTRAINT garmin_daily_steps_nonnegative CHECK (total_steps >= 0)
);
