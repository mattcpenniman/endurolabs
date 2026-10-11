// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GarminActivitySample } from "@/lib/garmin/activity-detail";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const suite = testDatabaseUrl ? describe : describe.skip;

suite("sample ingestion PostgreSQL integration", () => {
  const fixtureEmail = `sample-ingestion-${crypto.randomUUID()}@example.test`;
  const fixtureActivityId = crypto.randomUUID();
  let sql: ReturnType<typeof postgres>;
  let userId: string;
  let upsertActivitySamples: typeof import("@/lib/garmin/sample-ingestion")["upsertActivitySamples"];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    sql = postgres(testDatabaseUrl!, { prepare: false });
    [{ id: userId }] = await sql`insert into users (email, password_hash) values (${fixtureEmail}, 'test') returning id`;
    await sql`insert into run_activities (
      id, user_id, provider_activity_id, source, activity_name, activity_type, local_date,
      start_time_local, start_time_gmt, distance_meters, duration_seconds
    ) values (
      ${fixtureActivityId}, ${userId}, 'integration-activity', 'garmin', 'Integration run', 'running', '2026-08-03',
      '2026-08-03 07:00:00', ${new Date("2026-08-03T07:00:00Z")}, 5000, 1200
    )`;
    ({ upsertActivitySamples } = await import("@/lib/garmin/sample-ingestion"));
  });

  afterAll(async () => {
    if (sql) {
      await sql`delete from users where id = ${userId}`;
      await sql.end();
    }
  });

  function samples(withHeartRate: boolean): GarminActivitySample[] {
    return Array.from({ length: 41 }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-08-03T07:00:00Z") + index * 30_000),
      elapsedSeconds: index * 30,
      distanceMeters: index * 125,
      heartRate: withHeartRate ? 130 + Math.floor(index / 5) : null,
      power: 280,
      speedMetersPerSecond: 4.1,
      elevationMeters: 10,
      grade: 0,
      cadence: 178,
      latitude: 51.5,
      longitude: -0.1,
      temperatureCelsius: 15,
    }));
  }

  it("is idempotent and keeps sample_count stable", async () => {
    expect(await upsertActivitySamples(fixtureActivityId, samples(true))).toBe(41);
    expect(await upsertActivitySamples(fixtureActivityId, samples(true))).toBe(41);
    const [row] = await sql`select sample_count as "sampleCount", detail_fetch_status as status from run_activities where id = ${fixtureActivityId}`;
    const [{ count }] = await sql`select count(*)::int as count from activity_samples where activity_id = ${fixtureActivityId}`;
    const [analytics] = await sql`select id, source_sample_count as "sourceSampleCount" from activity_analytics where activity_id = ${fixtureActivityId} and algorithm_version = 'activity-metrics-v1'`;
    const [{ windowCount }] = await sql`select count(*)::int as "windowCount" from activity_metric_windows where activity_analytics_id = ${analytics.id}`;
    expect(count).toBe(41);
    expect(row).toMatchObject({ sampleCount: 41, status: "success" });
    expect(analytics.sourceSampleCount).toBe(41);
    expect(windowCount).toBe(41);
  });

  it("persists a below-threshold score when heart rate is absent", async () => {
    await upsertActivitySamples(fixtureActivityId, samples(false));
    const [row] = await sql`select quality_score as "qualityScore" from run_activities where id = ${fixtureActivityId}`;
    expect(row.qualityScore).toBeLessThan(60);
  });

  it("upserts one run score and invalidates it after cadence/detail changes", async () => {
    const original = samples(true);
    await upsertActivitySamples(fixtureActivityId, original);
    await upsertActivitySamples(fixtureActivityId, original);
    const [first] = await sql`select id, metrics from activity_analytics where activity_id = ${fixtureActivityId} and algorithm_version = 'run-score-v2'`;
    expect(first.metrics.runScore).toMatchObject({ score: 8, partial: true, availableWeight: 30 });
    await upsertActivitySamples(fixtureActivityId, original.map((sample) => ({ ...sample, cadence: 150 })));
    const rows = await sql`select id, metrics from activity_analytics where activity_id = ${fixtureActivityId} and algorithm_version = 'run-score-v2'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].metrics.runScore.score).toBe(0);
    expect(rows[0].metrics.fingerprint).not.toBe(first.metrics.fingerprint);
  });

  it("reads legacy plan JSON, refreshes after plan edits, and keeps preview read-only", async () => {
    await upsertActivitySamples(fixtureActivityId, samples(true));
    const workout = { id: "fixture-workout", type: "easy", title: "Fixture", totalDistance: 5000 / 1609.344,
      estimatedDuration: 20, segments: [{ type: "easy", description: "Easy", duration: 20, pace: 1609.344 / 4.1 / 60 }] };
    const planData = { runnerProfile: {}, paceZones: { easy: { min: 6, max: 7 }, recovery: 8, marathon: 6, threshold: 5, vo2: 4 },
      weeks: [{ days: [{ workout }] }] };
    const [{ id: planId }] = await sql`insert into plans (user_id, runner_profile, plan_data)
      values (${userId}, ${sql.json({})}, ${sql.json(JSON.stringify(planData))}) returning id`;
    await sql`update run_activities set plan_id = ${planId}, planned_workout_id = ${workout.id} where id = ${fixtureActivityId}`;
    const { db } = await import("@/lib/db/client");
    const { runActivities } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { loadRunScores } = await import("@/lib/analytics/run-score-persistence");
    const rows = await db.select().from(runActivities).where(eq(runActivities.id, fixtureActivityId));
    const [before] = await sql`select metrics from activity_analytics where activity_id = ${fixtureActivityId} and algorithm_version = 'run-score-v2'`;
    expect((await loadRunScores(rows, { dryRun: true })).get(fixtureActivityId)).toMatchObject({ score: 9.4, partial: false });
    const [preview] = await sql`select metrics from activity_analytics where activity_id = ${fixtureActivityId} and algorithm_version = 'run-score-v2'`;
    expect(preview.metrics).toEqual(before.metrics);
    await loadRunScores(rows);
    const changedPlan = { ...planData, weeks: [{ days: [{ workout: { ...workout, totalDistance: workout.totalDistance * 2 } }] }] };
    await sql`update plans set plan_data = ${sql.json(changedPlan)} where id = ${planId}`;
    expect((await loadRunScores(rows)).get(fixtureActivityId)?.components.find((c) => c.key === "distance")?.score).toBe(0);
  });
});
