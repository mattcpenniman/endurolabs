-- Apply before deploying run-score-v3 (or use npm run db:push).
ALTER TABLE run_activities ADD COLUMN IF NOT EXISTS effort_override varchar(32);
