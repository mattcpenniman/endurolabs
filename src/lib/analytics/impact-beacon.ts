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
import {
  fitSpeedPowerModel,
  summarySpeed,
  type PowerActivitySummary,
} from "./modeled-power";
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

export const IMPACT_BEACON_VERSION = "impact-beacon-v2";

/** Below this completion ratio an impact-eligible metric is behind plan. */
export const IMPACT_BEACON_BEHIND_RATIO = 0.9;
/** Above this completion ratio an impact-eligible metric is ahead of plan. */
export const IMPACT_BEACON_AHEAD_RATIO = 1.1;

/** Weeks compared before a plan starts: its opening block vs the trailing actuals. */
export const IMPACT_BEACON_BASELINE_WEEKS = 4;

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
  /** Moving duration when the provider reports it; speed falls back to duration. */
  movingDurationSeconds?: number | null;
  /**
   * Measured summary power in watts. Null/absent for runs without sensor
   * power (manual logs, estimated rows); only measured summaries ever feed
   * the derived power anchors.
   */
  averagePower?: number | null;
  /** Provider power source; `estimated_%` rows are never measured evidence. */
  powerSource?: string | null;
  /**
   * True for a race. Races count in every metric just like training runs,
   * matching the readiness feature definitions (`buildRaceTrainingFeatures`),
   * so a marathon the athlete just ran shows up as long-run and effort
   * evidence instead of being invisible.
   */
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

/**
 * `plan_to_date` compares the plan's schedule through today with the runs
 * inside the same window. `opening_block` is the pre-start view: the plan's
 * first weeks against the athlete's trailing actual training.
 */
export type ImpactBeaconMode = "plan_to_date" | "opening_block";

/** The two windows compared when the plan has not started yet. */
export interface ImpactBeaconBaseline {
  weeks: number;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string;
  actualEnd: string;
}

/** Effort zones the beacon measures, fastest-to-easiest anchor set. */
export type ImpactBeaconEffortZone = "marathon" | "threshold" | "vo2";

export interface ImpactBeaconHeartRateTarget {
  key: ImpactBeaconEffortZone;
  label: string;
  minBpm: number | null;
  maxBpm: number | null;
}

export interface ImpactBeaconPowerTarget {
  key: ImpactBeaconEffortZone;
  label: string;
  watts: number | null;
  /** True when a derived anchor lies outside the measured pace range it was fit on. */
  extrapolated: boolean;
}

/** Where the beacon's power anchors come from. */
export type ImpactBeaconPowerSource = "plan" | "measured";

export interface ImpactBeaconPowerBasis {
  /** `plan` for configured power zones, `measured` for a derived fit. */
  source: ImpactBeaconPowerSource;
  /** Measured runs behind a derived speed-to-power fit; null for plan zones. */
  measuredRuns: number | null;
  /** Short human-readable provenance for the UI. */
  note: string;
}

/** What the plan asks the athlete to hit, shown beside the plan-vs-actual rows. */
export interface ImpactBeaconTargets {
  /** Goal finish time in seconds, when the plan carries one. */
  goalSeconds: number | null;
  /** Goal marathon pace in minutes per mile. */
  goalPaceMinutesPerMile: number | null;
  /** Heart-rate ranges for the marathon-or-faster effort zones. */
  heartRate: ImpactBeaconHeartRateTarget[];
  /**
   * Power anchors for the same zones. The plan's configured zones win when
   * present; otherwise the anchors are derived from the athlete's measured
   * run summaries (speed-to-power fit) and labeled as measured. Null when
   * neither the plan nor the measured runs can supply them.
   */
  power: ImpactBeaconPowerTarget[] | null;
  /** Provenance for `power`; null when `power` is null. */
  powerBasis: ImpactBeaconPowerBasis | null;
}

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

/**
 * Traffic-light status for the floating beacon: `red` when an
 * impact-eligible metric is behind plan, `amber` when eligible metrics are
 * on/ahead but a context-only metric is behind or its sample detail is
 * missing, `green` when all eligible metrics are on/ahead.
 */
export type ImpactBeaconLevel = "red" | "amber" | "green";

export interface ImpactBeaconReport {
  version: typeof IMPACT_BEACON_VERSION;
  planId: string;
  asOf: string;
  mode: ImpactBeaconMode;
  /** Present only when `mode` is `opening_block`. */
  baseline: ImpactBeaconBaseline | null;
  planStarted: boolean;
  /** Plan weeks that have started by the as-of date. */
  weeksElapsed: number;
  race: {
    name: string | null;
    date: string;
    goalSeconds: number | null;
  };
  /** Goal time, pace, and the HR/power targets behind the effort metrics. */
  targets: ImpactBeaconTargets;
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

function isoDay(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** First scheduled plan day, or null when the plan carries no weeks. */
export function planStartDate(plan: MarathonPlan): string | null {
  const weeks = planWeeks(plan);
  if (weeks.length === 0) return null;
  const start = day(weeks[0].startDate ?? "");
  return start === "" ? null : start;
}

export interface ImpactBeaconBaselineWindow {
  /** First day of the trailing actual window. */
  start: string;
  /** Last day of the trailing actual window (the as-of date). */
  end: string;
  weeks: number;
  /** One 7-day bucket per week, oldest first, clipped to the as-of date. */
  windows: Array<{ start: string; end: string }>;
}

/**
 * The trailing actual window compared with the plan's opening block before
 * the plan starts: `weeks` complete 7-day buckets ending on the as-of date.
 */
export function impactBeaconBaselineWindow(
  asOf: string,
  weeks: number = IMPACT_BEACON_BASELINE_WEEKS,
): ImpactBeaconBaselineWindow {
  const endMs = Date.parse(`${asOf}T00:00:00Z`);
  const startMs = endMs - (weeks * 7 - 1) * DAY_MS;
  const windows = Array.from({ length: weeks }, (_, index) => ({
    start: isoDay(startMs + index * 7 * DAY_MS),
    end: isoDay(Math.min(startMs + (index * 7 + 6) * DAY_MS, endMs)),
  }));
  return { start: isoDay(startMs), end: isoDay(endMs), weeks, windows };
}

/** Plan weeks that have started by the cutoff, each clipped to it. */
function planWeekWindows(plan: MarathonPlan, through: string): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  for (const week of planWeeks(plan)) {
    const weekStart = day(week.startDate ?? "");
    if (!weekStart || weekStart > through) continue;
    const weekEnd = day(week.endDate ?? weekStart);
    windows.push({ start: weekStart, end: weekEnd < through ? weekEnd : through });
  }
  return windows;
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
  runs: ImpactBeaconRun[],
  start: string,
  through: string,
  weekWindows: Array<{ start: string; end: string }>,
): ActualTraining {
  const inWindow = runs.filter((run) => {
    const date = day(run.date ?? "");
    return date !== "" && date >= start && date <= through;
  });

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

  for (const run of inWindow) {
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
  for (const window of weekWindows) {
    if (inWindow.some((run) => {
      const date = day(run.date ?? "");
      return date >= window.start && date <= window.end;
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

/** Runs inside an inclusive window; runs after the cutoff never feed the report. */
function runsBetween(runs: ImpactBeaconRun[], start: string, through: string): ImpactBeaconRun[] {
  return runs.filter((run) => {
    const date = day(run.date ?? "");
    return date !== "" && date >= start && date <= through;
  });
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

interface ComparisonLabels {
  /** True when the planned side is the plan's opening block. */
  opening: boolean;
  /** Planned-side phrase, e.g. "in the plan's first 4 weeks". */
  planned: string;
  /** Actual-side phrase, e.g. "in the trailing 4 weeks". */
  actual: string;
}

function comparisonLabels(mode: ImpactBeaconMode, weeks: number): ComparisonLabels {
  if (mode !== "opening_block") {
    return { opening: false, planned: "through the cutoff", actual: "" };
  }
  const suffix = weeks === 1 ? "week" : "weeks";
  return {
    opening: true,
    planned: `in the plan's first ${weeks} ${suffix}`,
    actual: `in the trailing ${weeks} ${suffix}`,
  };
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
  labels: ComparisonLabels,
): ImpactBeaconMetricStatus {
  const components: ImpactBeaconComponent[] = [{
    label: "Run minutes",
    planned: planned.minutes,
    actual: actual.minutes,
    unit: "minutes",
  }];
  const actualPhrase = labels.actual ? ` ${labels.actual}` : "";
  const evidence = planned.miles > 0
    ? `Planned ${formatValue(planned.miles, "miles")} ${labels.planned}; logged `
      + `${formatValue(actual.miles, "miles")}${actualPhrase} (${formatRatio(actual.miles / planned.miles)} `
      + `of plan, ${formatDelta(actual.miles - planned.miles, "miles")}).`
    : labels.opening
      ? "No plan mileage is scheduled in the opening block."
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
  labels: ComparisonLabels,
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
  if (labels.opening) {
    if (planned.longestRunMiles === null) {
      evidence = "No long run is scheduled in the opening block.";
    } else {
      const ratio = planned.longestRunMiles > 0 ? actual.longestRunMiles / planned.longestRunMiles : null;
      evidence = `Longest scheduled run ${labels.planned} ${formatValue(planned.longestRunMiles, "miles")}; `
        + `longest logged run ${labels.actual} ${formatValue(actual.longestRunMiles, "miles")} `
        + `(${formatRatio(ratio)}).`;
    }
  } else if (planned.longestRunMiles === null) {
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
  labels: ComparisonLabels,
): ImpactBeaconMetricStatus {
  const evidence = planned.weeksElapsed > 0
    ? labels.opening
      ? `${actual.activeWeeks} of ${planned.weeksElapsed} opening-block weeks logged training `
        + `${labels.actual} (${formatRatio(actual.activeWeeks / planned.weeksElapsed)}).`
      : `${actual.activeWeeks} of ${planned.weeksElapsed} elapsed plan weeks logged training `
        + `(${formatRatio(actual.activeWeeks / planned.weeksElapsed)}).`
    : labels.opening
      ? "The opening block has no scheduled weeks."
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
  labels: ComparisonLabels,
  powerZonesConfigured: boolean,
): ImpactBeaconMetricStatus {
  const isHeartRate = key === "hr_effort";
  const measuredRuns = isHeartRate ? actual.hrMeasuredRuns : actual.powerMeasuredRuns;
  const effortMinutes = isHeartRate ? actual.hrEffortMinutes : actual.powerEffortMinutes;
  const thresholdMinutes = isHeartRate ? actual.hrThresholdMinutes : actual.powerThresholdMinutes;
  const marathonMinutes = isHeartRate ? actual.hrMarathonMinutes : actual.powerMarathonMinutes;
  const source = isHeartRate ? "heart-rate" : "measured-power";
  const dataMissing = planned.effortMinutes > 0 && measuredRuns === 0;
  const missingMeasure = !isHeartRate && !powerZonesConfigured
    ? "the plan has no power zones, so measured power was not bucketed"
    : "no stored sample detail is available to measure it";

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
  if (labels.opening) {
    if (planned.effortMinutes <= 0) {
      evidence = "No marathon-pace or faster work is scheduled in the opening block.";
    } else if (dataMissing) {
      evidence = `Scheduled ${formatValue(planned.effortMinutes, "minutes")} at marathon-or-faster `
        + `${source} effort ${labels.planned}; ${missingMeasure} ${labels.actual}.`;
    } else {
      const ratio = planned.effortMinutes > 0 && effortMinutes !== null
        ? effortMinutes / planned.effortMinutes
        : null;
      evidence = `Scheduled ${formatValue(planned.effortMinutes, "minutes")} at marathon-or-faster `
        + `${source} effort ${labels.planned}; recorded ${formatValue(effortMinutes ?? 0, "minutes")} `
        + `${labels.actual} from ${measuredRuns} run${measuredRuns === 1 ? "" : "s"} with samples `
        + `(${formatRatio(ratio)}).`;
    }
  } else if (planned.effortMinutes <= 0) {
    evidence = "No marathon-pace or faster work has been scheduled yet.";
  } else if (dataMissing) {
    evidence = `Scheduled ${formatValue(planned.effortMinutes, "minutes")} at marathon-or-faster `
      + `${source} effort; ${missingMeasure}.`;
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

const EFFORT_ZONE_LABELS: Record<ImpactBeaconEffortZone, string> = {
  marathon: "Marathon effort",
  threshold: "Threshold",
  vo2: "VO2",
};

const EFFORT_ZONE_KEYS: readonly ImpactBeaconEffortZone[] = ["marathon", "threshold", "vo2"];

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function zonePace(plan: MarathonPlan, key: ImpactBeaconEffortZone): number | null {
  const pace = plan.paceZones?.[key];
  return typeof pace === "number" && Number.isFinite(pace) && pace > 0 ? pace : null;
}

function paceSpeedMetersPerSecond(paceMinutesPerMile: number): number {
  return METERS_PER_MILE / (paceMinutesPerMile * 60);
}

/**
 * Measured run summaries usable for the speed-to-power fit. Manual logs and
 * previously estimated rows carry no measured power and are excluded, so the
 * model never trains on its own output.
 */
function measuredSummaryRuns(runs: ImpactBeaconRun[]): PowerActivitySummary[] {
  const measured: PowerActivitySummary[] = [];
  for (const run of runs) {
    const averagePower = finite(run.averagePower);
    const durationSeconds = finite(run.durationSeconds);
    const miles = finite(run.miles);
    const powerSource = run.powerSource ?? "unknown";
    if (averagePower === null || durationSeconds === null || durationSeconds <= 0) continue;
    if (miles === null || miles <= 0 || powerSource.startsWith("estimated_")) continue;
    measured.push({
      distanceMeters: miles * METERS_PER_MILE,
      durationSeconds,
      movingDurationSeconds: finite(run.movingDurationSeconds),
      averagePower,
      powerSource,
    });
  }
  return measured;
}

interface DerivedPowerTargets {
  power: ImpactBeaconPowerTarget[] | null;
  basis: ImpactBeaconPowerBasis | null;
}

/**
 * Power anchors derived from the athlete's own measured run summaries. The
 * model is the same athlete-specific speed-to-power fit used for
 * `calculated_power`; each plan pace zone is converted to speed and evaluated
 * on that fit. Anchors outside the measured pace range are flagged so the UI
 * never presents an extrapolation as if it were directly observed.
 */
function derivePowerTargets(plan: MarathonPlan, runs: ImpactBeaconRun[]): DerivedPowerTargets {
  const measured = measuredSummaryRuns(runs);
  const model = fitSpeedPowerModel(measured);
  if (!model) return { power: null, basis: null };

  const speeds = measured.map((run) => summarySpeed(run));
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  let extrapolatedAnchors = 0;

  const power: ImpactBeaconPowerTarget[] = EFFORT_ZONE_KEYS.map((key) => {
    const pace = zonePace(plan, key);
    const speed = pace === null ? null : paceSpeedMetersPerSecond(pace);
    const watts = speed === null ? null : Math.round(model.intercept + model.slope * speed);
    const extrapolated = speed !== null && (speed < minSpeed || speed > maxSpeed);
    if (extrapolated) extrapolatedAnchors += 1;
    return { key, label: EFFORT_ZONE_LABELS[key], watts, extrapolated };
  });
  if (power.every((target) => target.watts === null)) return { power: null, basis: null };

  const extrapolationNote = extrapolatedAnchors === 0
    ? ""
    : `; ${extrapolatedAnchors} anchor${extrapolatedAnchors === 1 ? " is" : "s are"} beyond your measured pace range`;
  return {
    power,
    basis: {
      source: "measured",
      measuredRuns: measured.length,
      note: `Derived from ${measured.length} measured runs (speed-to-power fit)${extrapolationNote}.`,
    },
  };
}

/** Goal time/pace and the HR/power anchors the plan's effort rows measure. */
function beaconTargets(plan: MarathonPlan, runs: ImpactBeaconRun[]): ImpactBeaconTargets {
  const heartRateZones = plan.paceZones?.heartRateZones;
  const heartRate: ImpactBeaconHeartRateTarget[] = EFFORT_ZONE_KEYS.map((key) => ({
    key,
    label: EFFORT_ZONE_LABELS[key],
    minBpm: heartRateZones?.[key]?.targetBpm?.min ?? null,
    maxBpm: heartRateZones?.[key]?.targetBpm?.max ?? null,
  }));

  const powerZones = plan.powerZones;
  let power: ImpactBeaconPowerTarget[] | null;
  let powerBasis: ImpactBeaconPowerBasis | null;
  if (powerZones) {
    power = EFFORT_ZONE_KEYS.map((key) => ({
      key,
      label: EFFORT_ZONE_LABELS[key],
      watts: typeof powerZones[key] === "number" ? powerZones[key] : null,
      extrapolated: false,
    }));
    powerBasis = { source: "plan", measuredRuns: null, note: "Configured on this plan." };
  } else {
    ({ power, basis: powerBasis } = derivePowerTargets(plan, runs));
  }

  const goalSeconds = typeof plan.runnerProfile?.goalMarathonTime === "number"
    ? plan.runnerProfile.goalMarathonTime * 60
    : null;
  const planMarathonPace = plan.paceZones?.marathon;
  const goalPaceMinutesPerMile = typeof planMarathonPace === "number" && planMarathonPace > 0
    ? planMarathonPace
    : goalSeconds !== null
      ? goalSeconds / 60 / 26.2
      : null;

  return { goalSeconds, goalPaceMinutesPerMile, heartRate, power, powerBasis };
}

function collectGaps(metrics: ImpactBeaconMetricStatus[]): ImpactBeaconGap[] {
  return metrics
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
}

/**
 * Builds the plan-vs-actual impact beacon report. Once the plan has started,
 * the planned side is the plan's own schedule through `asOf` (pro-rating the
 * in-progress week, so a partial week is not treated as a full one) and the
 * actual side is filtered to the same window. Before the plan starts, the
 * planned side is its opening block — the first `IMPACT_BEACON_BASELINE_WEEKS`
 * weeks — and the actual side is the athlete's trailing actual training over
 * the same number of weeks, so a proposed plan still gets a beacon. Only
 * metrics in `beaconMetrics` (default: validated or provisional per
 * `beaconReadinessMetrics()`) can produce the beacon.
 */
export function buildImpactBeacon(input: ImpactBeaconInput): ImpactBeaconReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
    throw new Error(`Invalid as-of date: ${input.asOf}`);
  }
  const eligible = new Set<ReadinessMetricKey>(input.beaconMetrics ?? beaconReadinessMetrics());
  const powerZonesConfigured = Boolean(input.plan.powerZones);
  const weeks = planWeeks(input.plan);
  const planStart = planStartDate(input.plan) ?? "";
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

  if (planStart === "") {
    const targets = beaconTargets(input.plan, []);
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
      mode: "plan_to_date",
      baseline: null,
      planStarted: false,
      weeksElapsed: 0,
      race,
      targets,
      metrics,
      gaps: [],
      beacon: null,
      summary: "This plan has no scheduled weeks.",
    };
  }

  if (!planStarted) {
    const baselineWeeks = Math.min(IMPACT_BEACON_BASELINE_WEEKS, weeks.length);
    const opening = weeks[baselineWeeks - 1];
    const openingEnd = day(opening.endDate ?? opening.startDate ?? "");
    const window = impactBeaconBaselineWindow(input.asOf, baselineWeeks);
    const labels = comparisonLabels("opening_block", baselineWeeks);
    const planned = plannedTraining(input.plan, openingEnd);
    const actual = actualTraining(input.runs, window.start, window.end, window.windows);
    const targets = beaconTargets(input.plan, runsBetween(input.runs, window.start, window.end));

    const metrics: ImpactBeaconMetricStatus[] = [
      volumeMetric(planned, actual, eligible, labels),
      longRunMetric(planned, actual, eligible, labels),
      consistencyMetric(planned, actual, eligible, labels),
      effortMetric("hr_effort", planned, actual, eligible, labels, powerZonesConfigured),
      effortMetric("power_effort", planned, actual, eligible, labels, powerZonesConfigured),
    ];
    const gaps = collectGaps(metrics);
    const beacon = gaps[0] ?? null;
    const eligibleWithData = metrics.filter((metric) => metric.impactEligible && metric.direction !== "no_data");
    const suffix = baselineWeeks === 1 ? "week" : "weeks";
    let summary: string;
    if (beacon) {
      summary = `Plan starts ${planStart}. Largest gap: ${beacon.label} — `
        + `${formatValue(beacon.actual, beacon.unit)} now vs ${formatValue(beacon.planned, beacon.unit)} `
        + `in the plan's first ${baselineWeeks} ${suffix} (${formatRatio(beacon.completionRatio)}).`;
    } else if (eligibleWithData.length > 0) {
      summary = `Plan starts ${planStart}. On track: ${eligibleWithData.map((metric) => metric.label).join(", ")} `
        + `at or ahead of the plan's first ${baselineWeeks} ${suffix}.`;
    } else {
      summary = `Plan starts ${planStart}; not enough recent logged training to beacon a validated `
        + "readiness metric yet.";
    }

    return {
      version: IMPACT_BEACON_VERSION,
      planId: input.plan.id,
      asOf: input.asOf,
      mode: "opening_block",
      baseline: {
        weeks: baselineWeeks,
        plannedStart: planStart,
        plannedEnd: openingEnd,
        actualStart: window.start,
        actualEnd: window.end,
      },
      planStarted: false,
      weeksElapsed: 0,
      race,
      targets,
      metrics,
      gaps,
      beacon,
      summary,
    };
  }

  const planned = plannedTraining(input.plan, effectiveEnd);
  const actual = actualTraining(
    input.runs,
    planStart,
    effectiveEnd,
    planWeekWindows(input.plan, effectiveEnd),
  );
  const targets = beaconTargets(input.plan, runsBetween(input.runs, planStart, effectiveEnd));
  const labels = comparisonLabels("plan_to_date", planned.weeksElapsed);
  const metrics: ImpactBeaconMetricStatus[] = [
    volumeMetric(planned, actual, eligible, labels),
    longRunMetric(planned, actual, eligible, labels),
    consistencyMetric(planned, actual, eligible, labels),
    effortMetric("hr_effort", planned, actual, eligible, labels, powerZonesConfigured),
    effortMetric("power_effort", planned, actual, eligible, labels, powerZonesConfigured),
  ];

  const gaps = collectGaps(metrics);
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
    mode: "plan_to_date",
    baseline: null,
    planStarted: true,
    weeksElapsed: planned.weeksElapsed,
    race,
    targets,
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

/**
 * Traffic-light status for the floating beacon. Rejected metrics never turn
 * the beacon red; at most they make it amber as unresolved context.
 */
export function impactBeaconLevel(report: ImpactBeaconReport): ImpactBeaconLevel {
  if (report.gaps.length > 0) return "red";
  const contextConcern = report.metrics.some(
    (metric) => !metric.impactEligible && (metric.direction === "behind" || metric.dataMissing),
  );
  return contextConcern ? "amber" : "green";
}