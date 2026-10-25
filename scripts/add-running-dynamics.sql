-- VEC-1141: additive, nullable fractional Garmin sensor dynamics (DOC-368).
-- Lengths are centimeters, time milliseconds, percentages percentage points.
-- Balance is explicitly LEFT. Existing rows remain unavailable (NULL).
BEGIN;
ALTER TABLE run_activities
  ADD COLUMN IF NOT EXISTS vertical_oscillation_cm double precision,
  ADD COLUMN IF NOT EXISTS vertical_ratio_percent double precision,
  ADD COLUMN IF NOT EXISTS ground_contact_time_ms double precision,
  ADD COLUMN IF NOT EXISTS ground_contact_balance_left_percent double precision,
  ADD COLUMN IF NOT EXISTS stride_length_cm double precision;
ALTER TABLE activity_samples
  ADD COLUMN IF NOT EXISTS vertical_oscillation_cm double precision,
  ADD COLUMN IF NOT EXISTS vertical_ratio_percent double precision,
  ADD COLUMN IF NOT EXISTS ground_contact_time_ms double precision,
  ADD COLUMN IF NOT EXISTS ground_contact_balance_left_percent double precision,
  ADD COLUMN IF NOT EXISTS stride_length_cm double precision;
COMMIT;
