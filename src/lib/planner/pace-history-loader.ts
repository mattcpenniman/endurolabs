/** Bounded, read-only sample loading for the opt-in planner pace investigation. */
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { activitySamples, runActivities } from '@/lib/db/schema';
import type { ActivityChartSample } from '@/lib/activities/models';
import type { MarathonPlan } from '@/lib/training/models';
import { analyzePaceTrace, type PaceTrace } from './pace-history';

export async function loadPaceHistoryTraces(input: {
  userId: string; asOf: string; plan: MarathonPlan; goalPace: number;
}): Promise<Map<string, PaceTrace>> {
  const rows = await db.select({ id: runActivities.id, powerSource: runActivities.powerSource })
    .from(runActivities).where(and(eq(runActivities.userId, input.userId), lt(runActivities.localDate, input.asOf)));
  const result = new Map<string, PaceTrace>();
  for (let offset = 0; offset < rows.length; offset += 25) {
    const batch = rows.slice(offset, offset + 25);
    const samples = await db.select({ activityId: activitySamples.activityId, elapsedSeconds: activitySamples.elapsedSeconds,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond, elevationMeters: activitySamples.elevationMeters,
      heartRate: activitySamples.heartRate, power: activitySamples.power })
      .from(activitySamples).where(inArray(activitySamples.activityId, batch.map(a => a.id)))
      .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds));
    const byActivity = new Map<string, ActivityChartSample[]>();
    for (const sample of samples) {
      const list = byActivity.get(sample.activityId) ?? [];
      list.push({ ...sample, cadence: null }); byActivity.set(sample.activityId, list);
    }
    for (const a of batch) result.set(a.id, analyzePaceTrace({ samples: byActivity.get(a.id) ?? [], plan: input.plan,
      goalPace: input.goalPace, hasMeasuredPower: !a.powerSource.startsWith('estimated_') }));
  }
  return result;
}
