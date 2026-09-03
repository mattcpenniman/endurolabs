#!/usr/bin/env node

// Classifies legacy successful Garmin detail attempts that returned no samples.
// These runs remain as valid summary records; this script never deletes data.

import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const sql = postgres(process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab", { prepare: false });

try {
  const rows = await sql`
    select extract(year from start_time_gmt)::int as year,
      count(*)::int as activities,
      count(*) filter (where distance_meters > 0 and duration_seconds > 0)::int as "validSummaries"
    from run_activities
    where source = 'garmin' and samples_fetched_at is not null and sample_count = 0
    group by extract(year from start_time_gmt)
    order by year
  `;
  const updated = await sql`
    update run_activities
    set detail_fetch_status = 'empty', detail_last_error = null, detail_next_retry_at = null, updated_at = now()
    where source = 'garmin' and samples_fetched_at is not null and sample_count = 0
      and detail_fetch_status is null
    returning id
  `;
  const successful = await sql`
    update run_activities
    set detail_fetch_status = 'success', detail_last_error = null, detail_next_retry_at = null, updated_at = now()
    where source = 'garmin' and samples_fetched_at is not null and sample_count > 0
      and detail_fetch_status is null
    returning id
  `;
  console.log(JSON.stringify({
    classification: "legacy_detail_outcomes",
    emptyUpdated: updated.length,
    successUpdated: successful.length,
    emptyByYear: rows,
  }, null, 2));
} catch (error) {
  console.error("Legacy detail classification failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
