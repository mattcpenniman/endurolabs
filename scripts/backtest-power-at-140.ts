#!/usr/bin/env node

/** Backtest speed-modeled sample power against measured Power @ 140. */

import postgres from "postgres";
import { analyzePowerAtHeartRate } from "../src/lib/analytics/running-fitness";
import type { ActivitySampleInput } from "../src/lib/analytics/models";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

interface ActivityRow {
  id: string;
  localDate: string;
  distanceMeters: number;
  durationSeconds: number;
  movingDurationSeconds: number | null;
  averagePower: number;
}

interface Evaluation {
  label: string;
  actual: number;
  modeled: number;
  error: number;
  actualExtrapolated: boolean;
  modeledExtrapolated: boolean;
}

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://enduro:endurodev@localhost:5432/endurolab";
const planId = argument("plan-id");
const sql = postgres(databaseUrl, { prepare: false });

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fitSpeedPower(activities: ActivityRow[]): { intercept: number; slope: number } {
  const points = activities.map((activity) => ({
    speed: activity.distanceMeters / (activity.movingDurationSeconds ?? activity.durationSeconds),
    power: activity.averagePower,
  }));
  const meanSpeed = mean(points.map((point) => point.speed));
  const meanPower = mean(points.map((point) => point.power));
  const covariance = points.reduce((sum, point) => (
    sum + (point.speed - meanSpeed) * (point.power - meanPower)
  ), 0);
  const variance = points.reduce((sum, point) => sum + (point.speed - meanSpeed) ** 2, 0);
  const slope = covariance / variance;
  return { slope, intercept: meanPower - slope * meanSpeed };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p140(samples: ActivitySampleInput[]): { watts: number; extrapolated: boolean } | null {
  const model = analyzePowerAtHeartRate(samples, [140]);
  const estimate = model?.estimates[0];
  return estimate ? { watts: estimate.watts, extrapolated: estimate.extrapolated } : null;
}

function modeledSamples(
  samples: ActivitySampleInput[],
  formula: { intercept: number; slope: number },
): ActivitySampleInput[] {
  return samples.map((sample) => ({
    ...sample,
    power: sample.speedMetersPerSecond === null
      ? null
      : formula.intercept + formula.slope * sample.speedMetersPerSecond,
  }));
}

function summarize(evaluations: Evaluation[]): Record<string, number> | null {
  if (evaluations.length === 0) return null;
  return {
    comparisons: evaluations.length,
    maeWatts: mean(evaluations.map((evaluation) => Math.abs(evaluation.error))),
    rmseWatts: Math.sqrt(mean(evaluations.map((evaluation) => evaluation.error ** 2))),
    biasWatts: mean(evaluations.map((evaluation) => evaluation.error)),
    maxAbsoluteErrorWatts: Math.max(...evaluations.map((evaluation) => Math.abs(evaluation.error))),
  };
}

try {
  if (!planId) throw new Error("Usage: npm run power:p140-backtest -- --plan-id UUID");
  const activities = await sql<ActivityRow[]>`
    select id, local_date as "localDate", distance_meters as "distanceMeters",
      duration_seconds as "durationSeconds", moving_duration_seconds as "movingDurationSeconds",
      average_power as "averagePower"
    from run_activities
    where plan_id = ${planId}
      and average_power is not null
      and power_source not like 'estimated_%'
    order by local_date, start_time_gmt
  `;
  if (activities.length < 5) throw new Error(`Only ${activities.length} measured activities are available`);

  const samplesByActivity = new Map<string, ActivitySampleInput[]>();
  for (const activity of activities) {
    const samples = await sql<ActivitySampleInput[]>`
      select activity_id as "activityId", elapsed_seconds as "elapsedSeconds",
        heart_rate as "heartRate", power, speed_meters_per_second as "speedMetersPerSecond"
      from activity_samples
      where activity_id = ${activity.id}
      order by elapsed_seconds
    `;
    samplesByActivity.set(activity.id, samples);
  }

  const activityEvaluations: Evaluation[] = [];
  for (const activity of activities) {
    const formula = fitSpeedPower(activities.filter((candidate) => candidate.id !== activity.id));
    const samples = samplesByActivity.get(activity.id) ?? [];
    const actual = p140(samples);
    const modeled = p140(modeledSamples(samples, formula));
    if (!actual || !modeled) continue;
    activityEvaluations.push({
      label: `${activity.localDate}:${activity.id.slice(0, 8)}`,
      actual: actual.watts,
      modeled: modeled.watts,
      error: modeled.watts - actual.watts,
      actualExtrapolated: actual.extrapolated,
      modeledExtrapolated: modeled.extrapolated,
    });
  }

  const dates = [...new Set(activities.map((activity) => activity.localDate))];
  const weekStarts = [...new Set(dates.map((date) => {
    const value = new Date(`${date}T00:00:00Z`);
    const day = value.getUTCDay();
    value.setUTCDate(value.getUTCDate() - ((day + 6) % 7));
    return value.toISOString().slice(0, 10);
  }))];
  const weekEvaluations: Evaluation[] = [];
  for (const weekStart of weekStarts) {
    const end = new Date(`${weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const weekEnd = end.toISOString().slice(0, 10);
    const validation = activities.filter((activity) => activity.localDate >= weekStart && activity.localDate <= weekEnd);
    const training = activities.filter((activity) => activity.localDate < weekStart || activity.localDate > weekEnd);
    if (training.length < 5) continue;
    const formula = fitSpeedPower(training);
    const samples = validation.flatMap((activity) => samplesByActivity.get(activity.id) ?? []);
    const actual = p140(samples);
    const modeled = p140(modeledSamples(samples, formula));
    if (!actual || !modeled) continue;
    weekEvaluations.push({
      label: weekStart,
      actual: actual.watts,
      modeled: modeled.watts,
      error: modeled.watts - actual.watts,
      actualExtrapolated: actual.extrapolated,
      modeledExtrapolated: modeled.extrapolated,
    });
  }

  const formula = fitSpeedPower(activities);
  const allSamples = activities.flatMap((activity) => samplesByActivity.get(activity.id) ?? []);
  const actualHeadline = p140(allSamples);
  const modeledHeadline = p140(modeledSamples(allSamples, formula));
  const result = {
    activities: activities.length,
    formula,
    headline: actualHeadline && modeledHeadline ? {
      actualWatts: actualHeadline.watts,
      modeledWatts: modeledHeadline.watts,
      errorWatts: modeledHeadline.watts - actualHeadline.watts,
    } : null,
    activityValidation: summarize(activityEvaluations),
    weekValidation: summarize(weekEvaluations),
    weeks: weekEvaluations,
  };
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Power @ 140 backtest failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
