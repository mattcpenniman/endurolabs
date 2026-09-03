// ============================================================
// EnduroLab - Garmin Sample Persistence
// ============================================================

import "server-only";

import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { GarminActivitySample } from "@/lib/garmin/activity-detail";

const INSERT_BATCH_SIZE = 500;

export async function upsertActivitySamples(activityId: string, samples: GarminActivitySample[]): Promise<number> {
  for (let start = 0; start < samples.length; start += INSERT_BATCH_SIZE) {
    const values = samples.slice(start, start + INSERT_BATCH_SIZE).map((sample) => ({ activityId, ...sample }));
    await db.insert(activitySamples).values(values).onConflictDoUpdate({
      target: [activitySamples.activityId, activitySamples.elapsedSeconds],
      set: {
        timestamp: sql`excluded.timestamp`,
        distanceMeters: sql`excluded.distance_meters`,
        heartRate: sql`excluded.heart_rate`,
        power: sql`excluded.power`,
        speedMetersPerSecond: sql`excluded.speed_meters_per_second`,
        elevationMeters: sql`excluded.elevation_meters`,
        grade: sql`excluded.grade`,
        cadence: sql`excluded.cadence`,
        latitude: sql`excluded.latitude`,
        longitude: sql`excluded.longitude`,
        temperatureCelsius: sql`excluded.temperature_celsius`,
      },
    });
  }

  await db.delete(activitySamples).where(and(
    eq(activitySamples.activityId, activityId),
    sql`abs(extract(epoch from (${activitySamples.timestamp} - (select ${runActivities.startTimeGmt} from ${runActivities} where ${runActivities.id} = ${activityId}))) - ${activitySamples.elapsedSeconds}) > 2`
  ));

  const [result] = await db.select({ value: count() })
    .from(activitySamples)
    .where(eq(activitySamples.activityId, activityId));
  const sampleCount = result?.value ?? 0;
  await db.update(runActivities).set({
    sampleCount,
    samplesFetchedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(runActivities.id, activityId));
  return sampleCount;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
