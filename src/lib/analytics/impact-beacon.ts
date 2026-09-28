// ============================================================
// EnduroLab — Plan-vs-Actual Impact Beacon
// ============================================================
// Compares the athlete's logged training with the goal-derived
// plan on the readiness metrics, and beacons the largest
// behind-plan gap among the metrics that validation allows to be
// presented as impact (`beaconReadinessMetrics()`).
//
// The planned side is the plan's own schedule through the as-of
// date. Because the plan is generated from the goal, those
// standards are goal-parameterized: the beacon never invents a
// target the plan does not already carry. The actual side uses run
// summaries and, where stored samples exist, the output of
// `summarizeTimeAtEffort`. Metrics whose validation tier is
// `rejected` are still reported as context, but they can never be
// the beacon.
// ============================================================

import {
  READINESS_METRIC_PROMOTIONS,
  beaconReadinessMetrics,
  type ReadinessPromotionTier,
} from "./readiness-metrics";
import {
  READINESS_METRIC_KEYS,
  type ReadinessMetricKey,
} from "./race-performance-analysis";
import type {
  EffortZone,
  TimeAtEffortBreakdown,
  TimeAtEffortSummary,
} from "./time-at-effort";
import type {
  MarathonPlan,
  WeeklyPlan,
  Workout,
  WorkoutSegment,
} from "@/lib/training/models";

export const IMPACT_BEACON_VERSION = "impact-beacon-v1";

/** Below this completion ratio an impact-eligible metric is behind plan. */
export const IMPACT_BEACON_BEHIND_RATIO = 0.9;
/** Above this completion ratio an impact-eligible metric is ahead of plan. */
export const IMPACT_BEACON_AHEAD_RATIO = 1.1;

/** Runs of at least this many miles count as long-run finish work. */
const LONG_RUN_FINISH_MIN_MILES = 12;
const METERS_PER_MILE = 1609.344;
const DAY_MS = 86_400_000;

// ─── Inputs ────────────────────────────────────────────────

export interface ImpactBeaconRun {
  /** YYYY-MM-DD local date. */
  date: string;
  miles: number;
  durationSeconds?: number | null;
  /** True for a race; races count as load but not training long-run or effort exposure. */
  race?: boolean;
  /** Time at effort from stored samples; null when detail was not loaded. */
  timeAtEffort?: TimeAtEffortSummary | null;
}

export interface ImpactBeaconInput {
  plan: MarathonPlan;
  /** Actual runs in any order; the module filters them to the plan window. */
  runs: ImpactBeaconRun[];
  /** Analysis cutoff (YYYY-MM-DD); later scheduled work and runs are ignored. */
  asOf: string;
  /**
   * Metrics that may be beaconed. Defaults to `beaconReadinessMetrics()`;
   * exposing it lets callers and tests pin the eligible set explicitly.
   */
  beaconMetrics?: readonly ReadinessMetricKey[];
}

// ─── Outputs ───────────────────────────────────────────────

export type ImpactBeaconDirection = "ahead" | "on_track" | "behind" | "no_data";

export type ImpactBeaconUnit = "miles" | "minutes" | "count" | "weeks";

export interface ImpactBeaconComponent {
  label: string;
  planned: number | null;
  actual: number | null;
  unit: ImpactBeaconUnit;
}

export interface ImpactBeaconMetricStatus {
  key: ReadinessMetricKey;
  label: string;
  definition: string;
  tier: ReadinessPromotionTier;
  /** Only validated/provisional metrics may be rendered as impact. */
  impactEligible: boolean;
  unit: ImpactBeaconUnit;
  planned: number | null;
  actual: number | null;
  /** actual - planned, when both sides exist. */
  delta: number | null;
  /** actual / planned, when both sides exist and planned > 0. */
  completionRatio: number | null;
  direction: ImpactBeaconDirection;
  /** True when the metric needs sample detail that was not available. */
  dataMissing: boolean;
  evidence: string;
  components: ImpactBeaconComponent[];
}

export interface ImpactBeaconGap {
  key: ReadinessMetricKey;
  label: string;
  tier: ReadinessPromotionTier;
  planned: number;
  actual: number;
  delta: number;
  completionRatio: number;
  unit: ImpactBeaconUnit;
  evidence: string;
}

export interface ImpactBeaconReport {
  version: typeof IMPACT_BEACON_VERSION;
  planId: string;
  asOf: string;
  planStarted: boolean;
  /** Plan weeks that have started by the as-of date. */
  weeksElapsed: number;
  race: {
    name: string | null;
    date: string;
    goalSeconds: number | null;
  };
  metrics: ImpactBeaconMetricStatus[];
  /** Behind-plan eligible metrics, worst completion ratio first. */
  gaps: ImpactBeaconGap[];
  /** The largest gap among beacon-eligible metrics; null when none is behind. */
  beacon: ImpactBeaconGap | null;
  summary: string;
}

// ─── Date helpers ──────────────────────────────────────────

function day(value: string): string {
  return value.slice(0, 10);
}

function daysInclusive(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1,
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ─── Planned side ──────────────────────────────────────────

interface PlannedTraining {
  miles: number;
  minutes: number;
  longestRunMiles: number | null;
  longRunsAtLeast18: number;
  effortMinutes: number;
  thresholdMinutes: number;
  marathonPaceMinutes: number;
  longRunEffortMinutes: number;
  weeksElapsed: number;
}

function planWeeks(plan: MarathonPlan): WeeklyPlan[] {
  return (plan.weeks ?? []).filter((week) => week != null);
}

/**
 * Planned mileage through the cutoff, pro-rating the in-progress week so a
 * partial week is not counted as a full one.
 */
function plannedMilesThrough(plan: MarathonPlan, through: string): number {
  let total = 0;
  for (const week of planWeeks(plan)) {
    const start = day(week.startDate ?? "");
    if (!start || start > through) continue;
    const end = day(week.endDate ?? start);
    const mileage = typeof week.totalMileage === "number" ? week.totalMileage : 0;
    if (end <= through) {
      total += mileage;
      continue;
    }
    const weekDays = Math.max(1, daysInclusive(start, end));
    const elapsedDays = Math.min(weekDays, daysInclusive(start, through));
    total += mileage * (elapsedDays / weekDays);
  }
  return total;
}

function zonePaceForType(type: Workout["type"], plan: MarathonPlan): number | null {
  switch (type) {
    case "marathon_pace":
      return plan.paceZones?.marathon ?? null;
    case "threshold":
      return plan.paceZones?.threshold ?? null;
    case "vo2":
      return plan.paceZones?.vo2 ?? null;
    default:
      return null;
  }
}

/** Minutes a segment prescribes; explicit duration wins over distance x pace. */
function segmentMinutes(segment: WorkoutSegment, plan: MarathonPlan): number | null {
  const repetitions = segment.repetitions && segment.repetitions > 0 ? segment.repetitions : 1;
  if (typeof segment.duration === "number" && Number.isFinite(segment.duration) && segment.duration > 0) {
    return segment.duration * repetitions;
  }
  if (typeof segment.distance !== "number" || !Number.isFinite(segment.distance) || segment.distance <= 0) {
    return null;
  }
  const pace = segment.pace ?? zonePaceForType(segment.type, plan);
  if (typeof pace !== "number" || !Number.isFinite(pace) || pace <= 0) return null;
  return segment.distance * pace * repetitions;
}

function collectScheduledWorkouts(plan: MarathonPlan, through: string): Workout[] {
  const scheduled: Workout[] = [];
  for (const week of planWeeks(plan)) {
    for (const daily of week.days ?? []) {
      const date = day(daily.date ?? "");
      if (!date || date > through) continue;
      for (const workout of [daily.workout ?? null, daily.secondaryWorkout ?? null]) {
        if (workout) scheduled.push(workout);
      }
    }
  }
  return scheduled;
}

function plannedTraining(plan: MarathonPlan, through: string): PlannedTraining {
  let minutes = 0;
  let longestRunMiles: number | null = null;
  let longRunsAtLeast18 = 0;
  let effortMinutes = 0;
  let thresholdMinutes = 0;
  let marathonPaceMinutes = 0;
  let longRunEffortMinutes = 0;

  for (const workout of collectScheduledWorkouts(plan, through)) {
    if (workout.type === "race") continue;
    if (typeof workout.estimatedDuration === "number" && Number.isFinite(workout.estimatedDuration)) {
      minutes += workout.estimatedDuration;
    }
    const distance = typeof workout.totalDistance === "number" && Number.isFinite(workout.totalDistance)
      ? workout.totalDistance
      : 0;
    if (workout.type === "long") {
      longestRunMiles = Math.max(longestRunMiles ?? 0, distance);
      if (distance >= 18) longRunsAtLeast18 += 1;
    }
    for (const segment of workout.segments ?? []) {
      const segmentValue = segmentMinutes(segment, plan);
      if (segmentValue === null) continue;
      if (segment.type === "marathon_pace") {
        effortMinutes += segmentValue;
        marathonPaceMinutes += segmentValue;
        if (workout.type === "long") longRunEffortMinutes += segmentValue;
      } else if (segment.type === "threshold") {
        effortMinutes += segmentValue;
        thresholdMinutes += segmentValue;
      } else if (segment.type === "vo2") {
        effortMinutes += segmentValue;
      }
    }
  }

  const weeksElapsed = planWeeks(plan).filter((week) => day(week.startDate ?? "") <= through).length;

  return {
    miles: plannedMilesThrough(plan, through),
    minutes,
    longestRunMiles,
    longRunsAtLeast18,
    effortMinutes,
    thresholdMinutes,
    marathonPaceMinutes,
    longRunEffortMinutes,
    weeksElapsed,
  };
}

// ─── Actual side ───────────────────────────────────────────

const AT_OR_FASTER = new Set<EffortZone>(["marathon", "threshold", "vo2"]);

function bucketSeconds(breakdown: TimeAtEffortBreakdown, zone: "marathon" | "threshold"): number {
  let seconds = 0;
  for (const bucket of breakdown.buckets) {
    if (bucket.zone === zone) seconds += bucket.seconds;
  }
  return seconds;
}

function atOrFasterSeconds(breakdown: TimeAtEffortBreakdown): number {
  let seconds = 0;
  for (const bucket of breakdown.buckets) {
    if (AT_OR_FASTER.has(bucket.zone)) seconds += bucket.seconds;
  }
  return seconds;
}

interface ActualTraining {
  miles: number;
  minutes: number;
  longestRunMiles: number;
  longRunsAtLeast18: number;
  activeWeeks: number;
  hrMeasuredRuns: number;
  hrEffortMinutes: number | null;
  hrThresholdMinutes: number | null;
  hrMarathonMinutes: number | null;
  longRunFinishMeasuredRuns: number;
  longRunFinishMinutes: number | null;
  powerMeasuredRuns: number;
  powerEffortMinutes: number | null;
  powerThresholdMinutes: number | null;
  powerMarathonMinutes: number | null;
}

function actualTraining(
  plan: MarathonPlan,
  runs: ImpactBeaconRun[],
  start: string,
  through: string,
): ActualTraining {
  const inWindow = runs.filter((run) => {
    const date = day(run.date ?? "");
    return date !== "" && date >= start && date <= through;
  });
  const trainingRuns = inWindow.filter((run) => !run.race);

  let miles = 0;
  let minutes = 0;
  let longestRunMiles = 0;
  let longRunsAtLeast18 = 0;
  let hrMeasuredRuns = 0;
  let hrEffortSeconds = 0;
  let hrThresholdSeconds = 0;
  let hrMarathonSeconds = 0;
  let longRunFinishMeasuredRuns = 0;
  let longRunFinishSeconds = 0;
  let powerMeasuredRuns = 0;
  let powerEffortSeconds = 0;
  let powerThresholdSeconds = 0;
  let powerMarathonSeconds = 0;

  for (const run of inWindow) {
    const runMiles = Number.isFinite(run.miles) ? run.miles : 0;
    miles += runMiles;
    if (typeof run.durationSeconds === "number" && Number.isFinite(run.durationSeconds)) {
      minutes += run.durationSeconds / 60;
    }
  }

  for (const run of trainingRuns) {
    const runMiles = Number.isFinite(run.miles) ? run.miles : 0;
    longestRunMiles = Math.max(longestRunMiles, runMiles);
    if (runMiles >= 18) longRunsAtLeast18 += 1;

    const heartRate = run.timeAtEffort?.heartRate ?? null;
    if (heartRate) {
      hrMeasuredRuns += 1;
      hrEffortSeconds += atOrFasterSeconds(heartRate);
      hrThresholdSeconds += bucketSeconds(heartRate, "threshold");
      hrMarathonSeconds += bucketSeconds(heartRate, "marathon");
      if (runMiles >= LONG_RUN_FINISH_MIN_MILES) {
        longRunFinishMeasuredRuns += 1;
        longRunFinishSeconds += bucketSeconds(heartRate, "marathon");
      }
    }

    const power = run.timeAtEffort?.power ?? null;
    if (power) {
      powerMeasuredRuns += 1;
      powerEffortSeconds += atOrFasterSeconds(power);
      powerThresholdSeconds += bucketSeconds(power, "threshold");
      powerMarathonSeconds += bucketSeconds(power, "marathon");
    }
  }

  let activeWeeks = 0;
  for (const week of planWeeks(plan)) {
    const weekStart = day(week.startDate ?? "");
    if (!weekStart || weekStart > through) continue;
    const weekEnd = day(week.endDate ?? weekStart);
    const bound = weekEnd < through ? weekEnd : through;
    if (inWindow.some((run) => {
      const date = day(run.date ?? "");
      return date >= weekStart && date <= bound;
    })) {
      activeWeeks += 1;
    }
  }

  return {
    miles,
    minutes,
    longestRunMiles,
    longRunsAtLeast18,
    activeWeeks,
    hrMeasuredRuns,
    hrEffortMinutes: hrMeasuredRuns > 0 ? hrEffortSeconds / 60 : null,
    hrThresholdMinutes: hrMeasuredRuns > 0 ? hrThresholdSeconds / 60 : null,
    hrMarathonMinutes: hrMeasuredRuns > 0 ? hrMarathonSeconds / 60 : null,
    longRunFinishMeasuredRuns,
    longRunFinishMinutes: longRunFinishMeasuredRuns > 0 ? longRunFinishSeconds / 60 : null,
    powerMeasuredRuns,
    powerEffortMinutes: powerMeasuredRuns > 0 ? powerEffortSeconds / 60 : null,
    powerThresholdMinutes: powerMeasuredRuns > 0 ? powerThresholdSeconds / 60 : null,
    powerMarathonMinutes: powerMeasuredRuns > 0 ? powerMarathonSeconds / 60 : null,
  };
}

// ─── Formatting ────────────────────────────────────────────

function formatValue(value: number, unit: ImpactBeaconUnit): string {
  if (unit === "miles") return `${round1(value).toFixed(1)} mi`;
  if (unit === "minutes") return `${Math.round(value)} min`;
  if (unit === "weeks") return `${Math.round(value)} wk`;
  return `${Math.round(value)}`;
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? "n/a" : `${Math.round(ratio * 100)}%`;
}

function formatDelta(value: number, unit: ImpactBeaconUnit): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "+";
  return `${sign}${formatValue(Math.abs(value), unit)}`;
}

// ─── Metric assembly ───────────────────────────────────────

function promotionFor(key: ReadinessMetricKey): {
  label: string;
  definition: string;
  tier: ReadinessPromotionTier;
} {
  const promotion = READINESS_METRIC_PROMOTIONS.find((entry) => entry.key === key);
  return {
    label: promotion?.label ?? key,
    definition: promotion?.definition ?? "",
    tier: promotion?.tier ?? "rejected",
  };
}

function metricStatus(input: {
  key: ReadinessMetricKey;
  unit: ImpactBeaconUnit;
  planned: number | null;
  actual: number | null;
  dataMissing: boolean;
  evidence: string;
  components: ImpactBeaconComponent[];
  eligible: Set<ReadinessMetricKey>;
}): ImpactBeaconMetricStatus {
  const promotion = promotionFor(input.key);
  let delta: number | null = null;
  let completionRatio: number | null = null;
  let direction: ImpactBeaconDirection = "no_data";

  if (input.planned !== null && input.actual !== null) {
    delta = round1(input.actual - input.planned);
    if (input.planned > 0) {
      completionRatio = input.actual / input.planned;
      direction = completionRatio < IMPACT_BEACON_BEHIND_RATIO
        ? "behind"
        : completionRatio > IMPACT_BEACON_AHEAD_RATIO
          ? "ahead"
          : "on_track";
    } else if (input.actual > 0) {
      direction = "ahead";
    }
  }

  return {
    key: input.key,
    label: promotion.label,
    definition: promotion.definition,
    tier: promotion.tier,
    impactEligible: input.eligible.has(input.key),
    unit: input.unit,
    planned: input.planned === null ? null : round1(input.planned),
    actual: input.actual === null ? null : round1(input.actual),
    delta,
    completionRatio,
    direction,
    dataMissing: input.dataMissing,
    evidence: input.evidence,
    components: input.components,
  };
}

function volumeMetric(
  planned: PlannedTraining,
  actual: ActualTraining,
  eligible: Set<ReadinessMetricKey>,
): ImpactBeaconMetricStatus {
  const components: ImpactBeaconComponent[] = [{
    label: "Run minutes",
    planned: planned.minutes,
    actual: actual.minutes,
    unit: "minutes",
  }];
  const evidence = planned.miles > 0
    ? `Planned ${formatValue(planned.miles, "miles")} through the cutoff; logged `
      + `${formatValue(actual.miles, "miles")} (${formatRatio(actual.miles / planned.miles)} `
      + `of plan, ${formatDelta(actual.miles - planned.miles, "miles")}).`
    : "No plan mileage has elapsed yet.";
  return metricStatus({
    key: "volume",
    unit: "miles",
    planned: planned.miles,
    actual: actual.miles,
    dataMissing: false,
    evidence,
    components,
    eligible,
  });
}

function longRunMetric(
  planned: PlannedTraining,
  actual: ActualTraining,
  eligible: Set<ReadinessMetricKey>,
): ImpactBeaconMetricStatus {
  const components: ImpactBeaconComponent[] = [
    {
      label: "Long runs >= 18 mi",
      planned: planned.longRunsAtLeast18,
      actual: actual.longRunsAtLeast18,
      unit: "count",
    },
    {
      label: "Marathon-pace finish minutes",
      planned: round1(planned.longRunEffortMinutes),
      actual: actual.longRunFinishMinutes === null ? null : round1(actual.longRunFinishMinutes),
      unit: "minutes",
    },
  ];
  let evidence: string;
  if (planned.longestRunMiles === null) {
    evidence = "No long run has been scheduled yet.";
  } else if (actual.longestRunMiles <= 0) {
    evidence = `Longest scheduled run so far ${formatValue(planned.longestRunMiles, "miles")}; `
      + "no long run has been logged yet.";
  } else {
    const ratio = planned.longestRunMiles > 0 ? actual.longestRunMiles / planned.longestRunMiles : null;
    evidence = `Longest scheduled run so far ${formatValue(planned.longestRunMiles, "miles")}; `
      + `longest logged run ${formatValue(actual.longestRunMiles, "miles")} (${formatRatio(ratio)}).`;
  }
  return metricStatus({
    key: "long_run",
    unit: "miles",
    planned: planned.longestRunMiles,
    actual: actual.longestRunMiles,
    dataMissing: false,
    evidence,
    components,
    eligible,
  });
}

function consistencyMetric(
  planned: PlannedTraining,
  actual: ActualTraining,
  eligible: Set<ReadinessMetricKey>,
): ImpactBeaconMetricStatus {
  const evidence = planned.weeksElapsed > 0
    ? `${actual.activeWeeks} of ${planned.weeksElapsed} elapsed plan weeks logged training `
      + `(${formatRatio(actual.activeWeeks / planned.weeksElapsed)}).`
    : "No plan weeks have elapsed yet.";
  return metricStatus({
    key: "consistency",
    unit: "weeks",
    planned: planned.weeksElapsed,
    actual: actual.activeWeeks,
    dataMissing: false,
    evidence,
    components: [],
    eligible,
  });
}

function effortMetric(
  key: "hr_effort" | "power_effort",
  planned: PlannedTraining,
  actual: ActualTraining,
  eligible: Set<ReadinessMetricKey>,
): ImpactBeaconMetricStatus {
  const isHeartRate = key === "hr_effort";
  const measuredRuns = isHeartRate ? actual.hrMeasuredRuns : actual.powerMeasuredRuns;
  const effortMinutes = isHeartRate ? actual.hrEffortMinutes : actual.powerEffortMinutes;
  const thresholdMinutes = isHeartRate ? actual.hrThresholdMinutes : actual.powerThresholdMinutes;
  const marathonMinutes = isHeartRate ? actual.hrMarathonMinutes : actual.powerMarathonMinutes;
  const source = isHeartRate ? "heart-rate" : "measured-power";
  const dataMissing = planned.effortMinutes > 0 && measuredRuns === 0;

  const components: ImpactBeaconComponent[] = [
    {
      label: "Minutes at threshold",
      planned: round1(planned.thresholdMinutes),
      actual: thresholdMinutes === null ? null : round1(thresholdMinutes),
      unit: "minutes",
    },
    {
      label: "Minutes at marathon pace",
      planned: round1(planned.marathonPaceMinutes),
      actual: marathonMinutes === null ? null : round1(marathonMinutes),
      unit: "minutes",
    },
  ];

  let evidence: string;
  if (planned.effortMinutes <= 0) {
    evidence = "No marathon-pace or faster work has been scheduled yet.";
  } else if (dataMissing) {
    evidence = `Scheduled ${formatValue(planned.effortMinutes, "minutes")} at marathon-or-faster `
      + `${source} effort; no stored sample detail is available to measure it.`;
  } else {
    const ratio = planned.effortMinutes > 0 && effortMinutes !== null
      ? effortMinutes / planned.effortMinutes
      : null;
    evidence = `Scheduled ${formatValue(planned.effortMinutes, "minutes")} at marathon-or-faster `
      + `${source} effort through the cutoff; recorded ${formatValue(effortMinutes ?? 0, "minutes")} `
      + `from ${measuredRuns} run${measuredRuns === 1 ? "" : "s"} with samples (${formatRatio(ratio)}).`;
  }

  return metricStatus({
    key,
    unit: "minutes",
    planned: planned.effortMinutes,
    actual: dataMissing ? null : effortMinutes,
    dataMissing,
    evidence,
    components,
    eligible,
  });
}

// ─── Report ────────────────────────────────────────────────

const METRIC_UNITS: Record<ReadinessMetricKey, ImpactBeaconUnit> = {
  volume: "miles",
  long_run: "miles",
  consistency: "weeks",
  hr_effort: "minutes",
  power_effort: "minutes",
};

/**
 * Builds the plan-vs-actual impact beacon report. The planned side is the
 * plan's own schedule through `asOf` (pro-rating the in-progress week, so a
 * partial week is not treated as a full one). The actual side is filtered to
 * the same window. Only metrics in `beaconMetrics` (default: validated or
 * provisional per `beaconReadinessMetrics()`) can produce the beacon.
 */
export function buildImpactBeacon(input: ImpactBeaconInput): ImpactBeaconReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new Error(`Invalid as-of date: ${input.asOf}`);
  }
  const eligible = new Set<ReadinessMetricKey>(input.beaconMetrics ?? beaconReadinessMetrics());
  const weeks = planWeeks(input.plan);
  const planStart = weeks.length > 0 ? day(weeks[0].startDate ?? "") : "";
  const planEnd = weeks.length > 0
    ? day(weeks[weeks.length - 1].endDate ?? weeks[weeks.length - 1].startDate ?? "")
    : "";
  const planStarted = planStart !== "" && planStart <= input.asOf;
  const effectiveEnd = planEnd !== "" && planEnd < input.asOf ? planEnd : input.asOf;

  const race = {
    name: input.plan.runnerProfile?.raceName ?? null,
    date: input.plan.raceDay,
    goalSeconds: typeof input.plan.runnerProfile?.goalMarathonTime === "number"
      ? input.plan.runnerProfile.goalMarathonTime * 60
      : null,
  };

  if (!planStarted) {
    const metrics = READINESS_METRIC_KEYS.map((key) => metricStatus({
      key,
      unit: METRIC_UNITS[key],
      planned: null,
      actual: null,
      dataMissing: false,
      evidence: "The plan has not started; there is nothing to compare yet.",
      components: [],
      eligible,
    }));
    return {
      version: IMPACT_BEACON_VERSION,
      planId: input.plan.id,
      asOf: input.asOf,
      planStarted: false,
      weeksElapsed: 0,
      race,
      metrics,
      gaps: [],
      beacon: null,
      summary: planStart === ""
        ? "This plan has no scheduled weeks."
        : `This plan starts on ${planStart}; there is nothing to compare yet.`,
    };
  }

  const planned = plannedTraining(input.plan, effectiveEnd);
  const actual = actualTraining(input.plan, input.runs, planStart, effectiveEnd);

  const metrics: ImpactBeaconMetricStatus[] = [
    volumeMetric(planned, actual, eligible),
    longRunMetric(planned, actual, eligible),
    consistencyMetric(planned, actual, eligible),
    effortMetric("hr_effort", planned, actual, eligible),
    effortMetric("power_effort", planned, actual, eligible),
  ];

  const gaps: ImpactBeaconGap[] = metrics
    .filter((metric) => metric.impactEligible && metric.direction === "behind" && metric.completionRatio !== null)
    .sort((left, right) => (left.completionRatio ?? 1) - (right.completionRatio ?? 1))
    .map((metric) => ({
      key: metric.key,
      label: metric.label,
      tier: metric.tier,
      planned: metric.planned ?? 0,
      actual: metric.actual ?? 0,
      delta: metric.delta ?? 0,
      completionRatio: metric.completionRatio ?? 0,
      unit: metric.unit,
      evidence: metric.evidence,
    }));
  const beacon = gaps[0] ?? null;

  const eligibleWithData = metrics.filter((metric) => metric.impactEligible && metric.direction !== "no_data");
  let summary: string;
  if (beacon) {
    summary = `Largest gap: ${beacon.label} — ${formatValue(beacon.actual, beacon.unit)} of `
      + `${formatValue(beacon.planned, beacon.unit)} planned (${formatRatio(beacon.completionRatio)}).`;
  } else if (eligibleWithData.length > 0) {
    summary = `On track: ${eligibleWithData.map((metric) => metric.label).join(", ")} `
      + "at or ahead of plan.";
  } else {
    summary = `Not enough logged training through ${input.asOf} to beacon a validated readiness metric yet.`;
  }

  return {
    version: IMPACT_BEACON_VERSION,
    planId: input.plan.id,
    asOf: input.asOf,
    planStarted: true,
    weeksElapsed: planned.weeksElapsed,
    race,
    metrics,
    gaps,
    beacon,
    summary,
  };
}

/** Converts meters to miles; exported for loaders that read activity summaries. */
export function metersToMiles(meters: number): number {
  return Number.isFinite(meters) ? meters / METERS_PER_MILE : 0;
}