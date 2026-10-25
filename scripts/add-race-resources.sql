-- Apply before deploying the race resources API/UI. Files are included in DB backups.
CREATE TABLE IF NOT EXISTS race_resources (
  activity_id uuid PRIMARY KEY REFERENCES run_activities(id) ON DELETE CASCADE,
  results_url text
);
CREATE TABLE IF NOT EXISTS race_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES run_activities(id) ON DELETE CASCADE,
  filename varchar(180) NOT NULL,
  content_type varchar(32) NOT NULL,
  size_bytes integer NOT NULL,
  content_base64 text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS race_attachments_activity_idx ON race_attachments(activity_id);
