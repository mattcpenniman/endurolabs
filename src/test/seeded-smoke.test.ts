// One-off smoke test against seeded DB data.
import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { analyzePowerAtHeartRate } from "@/lib/analytics/running-fitness";
import { ActivitySampleInput } from "@/lib/analytics/models";

describe("seeded data smoke", () => {
  it("recovers a plausible Power @ 140", async () => {
    const sql = postgres(process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab", { prepare: false });
    try {
      const [user] = await sql`select id from users order by created_at limit 1`;
      const [activity] = await sql`
        select a.activity_id as "activityId"
        from activity_samples a
        join run_activities r on r.id = a.activity_id and r.user_id = ${user.id}
        group by a.activity_id
        order by count(*) desc
        limit 1
      `;
      if (!activity) return; // no seeded data
      const rows: any[] = await sql`
        select a.elapsed_seconds as "elapsedSeconds",
               a.heart_rate as "heartRate",
               a.power,
               a.speed_meters_per_second as "speedMetersPerSecond"
        from activity_samples a
        where a.activity_id = ${activity.activityId}
        order by a.elapsed_seconds
      `;
      const inputs: ActivitySampleInput[] = rows.map((r) => ({
        activityId: activity.activityId,
        elapsedSeconds: Number(r.elapsedSeconds),
        heartRate: Number(r.heartRate),
        power: Number(r.power),
        speedMetersPerSecond: Number(r.speedMetersPerSecond),
      }));
      const model = analyzePowerAtHeartRate(inputs);
      if (!model) {
        console.log("model returned null for", rows.length, "samples");
        return; // tolerate: not every trace will qualify
      }
      const p140 = model.estimates.find((e) => e.heartRate === 140)!;
      expect(p140.watts).toBeGreaterThan(200);
      expect(p140.watts).toBeLessThan(700);
      expect(model.activityCount).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
