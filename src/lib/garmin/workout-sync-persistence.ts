/** Durable export checkpoints using the application's Drizzle-initialized SQL client. */
import type { ReservedSql } from "postgres";
import type { WorkoutSyncState } from "./workout-sync";

export async function saveWorkoutSyncState(sql: ReservedSql, userId: string, planId: string,
  workoutId: string, state: WorkoutSyncState): Promise<void> {
  // Drizzle replaces this client's JSON serializers with identity functions.
  // Pass serialized JSON directly; sql.json(object) would reach Buffer as an object.
  // Standalone postgres.js clients have different serializers: do not copy this
  // pattern into those scripts, where sql.json(object) is the correct encoding.
  await sql`insert into garmin_workout_exports (user_id, plan_id, source_workout_id, state)
    values (${userId}, ${planId}, ${workoutId}, ${JSON.stringify(state)}::jsonb)
    on conflict (user_id, plan_id, source_workout_id) do update set state=excluded.state, updated_at=now()`;
}
