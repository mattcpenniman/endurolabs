/** PostgreSQL dynamics-only patching. Samples and success checkpoint commit together. */
import type { Sql } from "postgres";
import { DYNAMICS_BACKFILL_VERSION, DYNAMICS_COLUMNS, DYNAMICS_PROPERTIES, sampleCoverage } from "./dynamics-backfill";
import type { DetailSample, DynamicsCoverage } from "./dynamics-backfill";

export async function dynamicsCoverage(sql: Sql, ids: string[]): Promise<DynamicsCoverage & { samples: number }> {
  const [row] = await sql`select count(*)::int as samples,
    count(vertical_oscillation_cm)::int as vertical_oscillation_cm,
    count(vertical_ratio_percent)::int as vertical_ratio_percent,
    count(ground_contact_time_ms)::int as ground_contact_time_ms,
    count(ground_contact_balance_left_percent)::int as ground_contact_balance_left_percent,
    count(stride_length_cm)::int as stride_length_cm
    from activity_samples where activity_id in ${sql(ids)}`;
  return row as DynamicsCoverage & { samples: number };
}

export async function persistDynamicsDetail(sql: Sql, activityId: string, connectionId: string, token: string,
  samples: DetailSample[]): Promise<"succeeded" | "unavailable"> {
  const coverage = sampleCoverage(samples);
  const status = Object.values(coverage).some((count) => count > 0) ? "succeeded" : "unavailable";
  await sql.begin(async (tx) => {
    // Hold the connection row while committing; a newer owner must never be overwritten.
    const [owner] = await tx`select id from garmin_connections where id=${connectionId}
      and active_worker_token=${token} and active_job_lease_expires_at > now() for update`;
    if (!owner) throw new Error("ownership_lost");
    await tx`select id from run_activities where id=${activityId} for update`;
    const existing = await tx`select elapsed_seconds, timestamp from activity_samples where activity_id=${activityId} order by elapsed_seconds for update`;
    // Existing traces must align exactly. Changed sampling requires explicit reconciliation, not destructive replacement.
    if (existing.length && (existing.length !== samples.length || existing.some((row, index) =>
      row.elapsed_seconds !== samples[index].elapsedSeconds || new Date(row.timestamp).getTime() !== samples[index].timestamp.getTime()))) {
      throw new Error("stored_alignment_changed");
    }
    for (let offset = 0; offset < samples.length; offset += 500) {
      const rows = samples.slice(offset, offset + 500).map((sample) => ({ activity_id: activityId,
        elapsed_seconds: sample.elapsedSeconds, timestamp: sample.timestamp,
        ...Object.fromEntries(DYNAMICS_COLUMNS.map((column, index) => [column, sample[DYNAMICS_PROPERTIES[index]]])),
      }));
      // Do not touch provider summaries, HR/power, matching, overrides, exclusions, timestamps or IDs.
      await tx`insert into activity_samples ${tx(rows)} on conflict (activity_id, elapsed_seconds) do update set
        vertical_oscillation_cm=coalesce(excluded.vertical_oscillation_cm, activity_samples.vertical_oscillation_cm),
        vertical_ratio_percent=coalesce(excluded.vertical_ratio_percent, activity_samples.vertical_ratio_percent),
        ground_contact_time_ms=coalesce(excluded.ground_contact_time_ms, activity_samples.ground_contact_time_ms),
        ground_contact_balance_left_percent=coalesce(excluded.ground_contact_balance_left_percent, activity_samples.ground_contact_balance_left_percent),
        stride_length_cm=coalesce(excluded.stride_length_cm, activity_samples.stride_length_cm)`;
    }
    const stored = await tx`select elapsed_seconds, timestamp, vertical_oscillation_cm, vertical_ratio_percent,
      ground_contact_time_ms, ground_contact_balance_left_percent, stride_length_cm from activity_samples
      where activity_id=${activityId} order by elapsed_seconds`;
    if (stored.length !== samples.length || stored.some((row, index) =>
      row.elapsed_seconds !== samples[index].elapsedSeconds || new Date(row.timestamp).getTime() !== samples[index].timestamp.getTime()
      || DYNAMICS_COLUMNS.some((column, field) => samples[index][DYNAMICS_PROPERTIES[field]] !== null
        && row[column] !== samples[index][DYNAMICS_PROPERTIES[field]]))) throw new Error("coverage_mismatch");
    await tx`update garmin_dynamics_backfill set status=${status}, sample_count=${samples.length},
      coverage=${tx.json(coverage)}, error_code=null, next_retry_at=null, updated_at=now()
      where activity_id=${activityId} and version=${DYNAMICS_BACKFILL_VERSION}`;
  });
  return status;
}
