// ============================================================
// EnduroLab — Plan Fitness Aggregation
// ============================================================
// Buckets sample-level HR/power traces into plan week windows
// and derives a Power @ HR model per week plus a plan-level
// headline.
// ============================================================

import { ActivitySampleInput, PowerHeartRateModel, PowerSource } from "./models";
import { DEFAULT_FITNESS_CONFIG, analyzePowerAtHeartRate } from "./running-fitness";

/**
 * A sample tagged with the calendar date (YYYY-MM-DD) its activity
 * started. The API route assembles this from activity rows + samples so
 * the pure aggregation layer stays free of persistence concerns.
 */
export interface SampleWithActivityStart extends ActivitySampleInput {
  activityStartDate: string;   // YYYY-MM-DD (local)
}

export interface PlanFitness {
  headline: PowerHeartRateModel | null;   // aggregated over all weeks
  bestWeekModel: PowerHeartRateModel | null;  // the week window with the strongest P(140)
  best140: number | null;
  best140Wkg: number | null;
  weeks: Map<string, PowerHeartRateModel>; // keyed by week startDate (YYYY-MM-DD)
}

function weekOf(startDate: string, windowStart: string, windowEnd: string): boolean {
  return startDate >= windowStart && startDate <= windowEnd;
}

/**
 * Analyze plan fitness for each week window.
 * `weekWindows` is an array of { start, end } date strings (YYYY-MM-DD,
 * inclusive) that define each plan week. `samples` are tagged with the
 * activity start date so we can bucket them into the correct window.
 */
export function analyzePlanFitness(opts: {
  weekWindows: Array<{ start: string; end: string }>;
  samples: SampleWithActivityStart[];
  defaultWeightKg?: number | null;
  targets?: number[];
  source?: PowerSource;
  headlineModel?: PowerHeartRateModel | null;
}): PlanFitness {
  const {
    weekWindows,
    samples,
    defaultWeightKg = null,
    targets = [130, 140, 150],
    source = "garmin",
  } = opts;
  const weeks = new Map<string, PowerHeartRateModel>();
  let best: PowerHeartRateModel | null = null;
  let best140 = -Infinity;

  for (const window of weekWindows) {
    const windowSamples = samples.filter((s) => weekOf(s.activityStartDate, window.start, window.end));
    if (windowSamples.length === 0) continue;
    const model = analyzePowerAtHeartRate(
      windowSamples,
      targets,
      defaultWeightKg,
      source,
      DEFAULT_FITNESS_CONFIG,
    );
    if (model) {
      weeks.set(window.start, model);
      const p140 = model.estimates.find((e) => e.heartRate === 140)?.watts ?? -Infinity;
      if (p140 > best140) {
        best140 = p140;
        best = model;
      }
    }
  }

  const allSamples = samples;
  const headline = opts.headlineModel !== undefined
    ? opts.headlineModel
    : allSamples.length > 0
      ? analyzePowerAtHeartRate(allSamples, targets, defaultWeightKg, source, DEFAULT_FITNESS_CONFIG)
      : null;

  const best140Wkg = bestWeekModelWkg(best, defaultWeightKg);

  return {
    headline,
    bestWeekModel: best,
    best140: best140 === -Infinity ? null : Math.round(best140),
    best140Wkg,
    weeks,
  };
}

function bestWeekModelWkg(model: PowerHeartRateModel | null, weightKg: number | null): number | null {
  if (!model) return null;
  const estimate = model.estimates.find((e) => e.heartRate === 140);
  if (!estimate) return null;
  if (estimate.wattsPerKg !== null && Number.isFinite(estimate.wattsPerKg)) {
    return Math.round(estimate.wattsPerKg * 100) / 100;
  }
  if (weightKg && weightKg > 0) return Math.round((estimate.watts / weightKg) * 100) / 100;
  return null;
}
