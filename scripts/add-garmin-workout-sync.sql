-- Apply before deploying the planned-workout Garmin sync API/UI.
CREATE TABLE IF NOT EXISTS garmin_workout_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  source_workout_id varchar(255) NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS garmin_workout_exports_source_unique
  ON garmin_workout_exports(user_id, plan_id, source_workout_id);
