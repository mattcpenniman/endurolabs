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
    expect(count).toBe(41);
    expect(row).toMatchObject({ sampleCount: 41, status: "success" });
  });

  it("persists a below-threshold score when heart rate is absent", async () => {
    await upsertActivitySamples(fixtureActivityId, samples(false));
    const [row] = await sql`select quality_score as "qualityScore" from run_activities where id = ${fixtureActivityId}`;
    expect(row.qualityScore).toBeLessThan(60);
  });
});
