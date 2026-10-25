// @vitest-environment node
/** Exercise checkpoint encoding through the same Drizzle-initialized client as the API. */
import { describe, expect, it } from "vitest";
import { saveWorkoutSyncState } from "@/lib/garmin/workout-sync-persistence";
import type { WorkoutSyncState } from "@/lib/garmin/workout-sync";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("Garmin checkpoint PostgreSQL persistence", () => {
  it("stores JSON objects and upserts checkpoints on a Drizzle-initialized reserved connection", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { conn } = await import("@/lib/db/client");
    const sql = await conn.reserve();
    try {
      await sql`begin`;
      // Connection-local shadow table: no athlete or production export rows are touched.
      await sql`create temporary table garmin_workout_exports (
        user_id uuid not null, plan_id uuid not null, source_workout_id text not null,
        state jsonb not null, updated_at timestamp not null default now(),
        unique (user_id, plan_id, source_workout_id)
      ) on commit drop`;
      const userId = crypto.randomUUID(), planId = crypto.randomUUID();
      const first: WorkoutSyncState = { creation: { phase: "creating", fingerprint: "fixture" } };
      await saveWorkoutSyncState(sql, userId, planId, "test-run", first);
      const [created] = await sql`select state, jsonb_typeof(state) as kind from garmin_workout_exports`;
      expect(created.kind).toBe("object");
      expect(created.state).toEqual(first);
      const next: WorkoutSyncState = { creation: { phase: "created", fingerprint: "fixture", workoutId: 42 } };
      await saveWorkoutSyncState(sql, userId, planId, "test-run", next);
      const rows = await sql`select state, jsonb_typeof(state) as kind from garmin_workout_exports`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: next, kind: "object" });
    } finally {
      await sql`rollback`;
      sql.release();
      await conn.end();
    }
  });
});
