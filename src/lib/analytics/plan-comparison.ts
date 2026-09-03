// ============================================================
// EnduroLab — Plan Comparison (current vs prior, week by week)
// ============================================================
// Aligns two training cycles by week number and, for each week,
// reports planned vs actuals from synced/recorded activity plus
// any sample-derived fitness estimate present in that week's window.
// All functions are pure and side-effect free so they can be unit
// tested and reused on the server and client.
// ============================================================

import { MarathonPlan, WeeklyPlan } from "@/lib/training/models";
import { RunActivity } from "@/lib/activities/models";
import { PowerHeartRateModel } from "./models";

export interface WeekActuals {
  weekNumber: number;
  startDate: string;
  endDate: string;
  plannedMileage: number;
  actualMileage: number;
  activeRuns: number;
  longRunPlanned: number;
  longRunActual: number | null;
  averagePace: number | null;        // min/mile, distance-weighted
  averageHeartRate: number | null;   // bpm, distance-weighted
  averagePower: number | null;       // watts, distance-weighted
  averagePowerEstimated: boolean;    // includes one or more modeled activity summaries
  elevationGainMeters: number;
  totalDurationSeconds: number;
  adherence: number | null;          // 0-100 share of planned mileage covered
  fitness: PowerHeartRateModel | null;
  modeledFitness: PowerHeartRateModel | null;
}

export interface WeekComparisonRow {
  weekNumber: number;
  phase: string | null;
  current: WeekActuals | null;
  prior: WeekActuals | null;
  // Delta current - prior when both sides have actuals
  deltaMileage: number | null;
  deltaPace: number | null;          // minutes/mile; negative == faster
  deltaHeartRate: number | null;     // bpm; negative == lower effort for same work
  deltaPower140: number | null;      // watts; positive == more output at same HR
}

export interface PlanSummary {
  weekCount: number;
  plannedMileage: number;
  actualMileage: number;
  activeWeeks: number;
  averagePace: number | null;
  averageHeartRate: number | null;
  averagePower: number | null;
  averagePowerEstimated: boolean;
  adherence: number | null;
  fitnessBest140: number | null;
}

export interface PlanComparison {
  currentPlanId: string;
  priorPlanId: string | null;
  totalWeeks: number;
  weeks: WeekComparisonRow[];
  summaries: {
    current: PlanSummary | null;
    prior: PlanSummary | null;
  };
}

function toDateKey(date: string): string {
  return date.slice(0, 10);
}

function weekDateRange(week: WeeklyPlan): { start: string; end: string } {
  const lastDay = week.days[week.days.length - 1];
  const end = lastDay ? toDateKey(lastDay.date) : toDateKey(week.endDate);
  return { start: toDateKey(week.startDate), end };
}

function activitiesInWindow(activities: RunActivity[], week: WeeklyPlan): RunActivity[] {
  const { start, end } = weekDateRange(week);
  return activities.filter((activity) => activity.localDate >= start && activity.localDate <= end);
}

function distance(run: RunActivity): number {
  return Math.max(0, run.distanceMiles);
}

function weightedAverage(runs: RunActivity[], pick: (run: RunActivity) => number | null): number | null {
  const eligible = runs.filter((run) => pick(run) !== null && distance(run) > 0);
  if (eligible.length === 0) return null;
  const totalDistance = eligible.reduce((sum, run) => sum + distance(run), 0);
  if (totalDistance <= 0) return eligible.reduce((sum, run) => sum + (pick(run) as number), 0) / eligible.length;
  return eligible.reduce((sum, run) => sum + (pick(run) as number) * distance(run), 0) / totalDistance;
}

function longestRun(runs: RunActivity[]): number | null {
  if (runs.length === 0) return null;
  return Math.max(...runs.map((run) => distance(run)));
}

function buildWeekActuals(
  week: WeeklyPlan,
  activities: RunActivity[],
  fitnessForWeek: PowerHeartRateModel | null,
  modeledFitnessForWeek: PowerHeartRateModel | null,
): WeekActuals {
  const runs = activitiesInWindow(activities, week);
  const actualMileage = Math.round(runs.reduce((sum, run) => sum + distance(run), 0) * 10) / 10;
  const longRunActual = longestRun(runs);
  const totalDistance = runs.reduce((sum, run) => sum + distance(run), 0);
  const adherence =
    week.totalMileage > 0 ? Math.round((totalDistance / week.totalMileage) * 100) : null;

  return {
    weekNumber: week.weekNumber,
    startDate: toDateKey(week.startDate),
    endDate: weekDateRange(week).end,
    plannedMileage: week.totalMileage,
    actualMileage,
    activeRuns: runs.length,
    longRunPlanned: week.longRunDistance,
    longRunActual,
    averagePace: weightedAverage(runs, (run) => run.averagePaceMinutesPerMile),
    averageHeartRate: weightedAverage(runs, (run) => run.averageHeartRate),
    averagePower: weightedAverage(runs, (run) => run.averagePower),
    averagePowerEstimated: runs.some((run) => (
      run.averagePower !== null && run.powerSource?.startsWith("estimated_")
    )),
    elevationGainMeters: runs.reduce((sum, run) => sum + (run.elevationGainMeters ?? 0), 0),
    totalDurationSeconds: runs.reduce((sum, run) => sum + run.durationSeconds, 0),
    adherence,
    fitness: fitnessForWeek,
    modeledFitness: modeledFitnessForWeek,
  };
}

function powerAt140(model: PowerHeartRateModel | null): number | null {
  if (!model) return null;
  const estimate = model.estimates.find((e) => e.heartRate === 140) ?? model.estimates[0];
  if (!estimate || Number.isNaN(estimate.watts)) return null;
  return Math.round(estimate.watts);
}

export function comparePlans(opts: {
  currentPlan: MarathonPlan;
  priorPlan: MarathonPlan | null;
  currentActivities: RunActivity[];
  priorActivities: RunActivity[];
  currentFitnessByWeek?: Map<string, PowerHeartRateModel>;
  priorFitnessByWeek?: Map<string, PowerHeartRateModel>;
  currentModeledFitnessByWeek?: Map<string, PowerHeartRateModel>;
  priorModeledFitnessByWeek?: Map<string, PowerHeartRateModel>;
}): PlanComparison {
  const { currentPlan, priorPlan, currentActivities, priorActivities } = opts;
  const maxWeeks = Math.max(
    currentPlan.weeks.length,
    priorPlan?.weeks.length ?? 0,
  );

  const weeks: WeekComparisonRow[] = [];
  for (let n = 1; n <= maxWeeks; n += 1) {
    const currentWeek = currentPlan.weeks.find((w) => w.weekNumber === n) ?? null;
    const priorWeek = priorPlan?.weeks.find((w) => w.weekNumber === n) ?? null;

    const currentKey = currentWeek ? currentWeek.startDate.slice(0, 10) : null;
    const priorKey = priorWeek ? priorWeek.startDate.slice(0, 10) : null;
    const current = currentWeek
      ? buildWeekActuals(
          currentWeek,
          currentActivities,
          currentKey ? opts.currentFitnessByWeek?.get(currentKey) ?? null : null,
          currentKey ? opts.currentModeledFitnessByWeek?.get(currentKey) ?? null : null,
        )
      : null;
    const prior = priorWeek
      ? buildWeekActuals(
          priorWeek,
          priorActivities,
          priorKey ? opts.priorFitnessByWeek?.get(priorKey) ?? null : null,
          priorKey ? opts.priorModeledFitnessByWeek?.get(priorKey) ?? null : null,
        )
      : null;

    let deltaMileage: number | null = null;
    let deltaPace: number | null = null;
    let deltaHeartRate: number | null = null;
    let deltaPower140: number | null = null;
    if (current && prior) {
      if (current.actualMileage > 0 || prior.actualMileage > 0) {
        deltaMileage = Math.round((current.actualMileage - prior.actualMileage) * 10) / 10;
      }
      if (current.averagePace !== null && prior.averagePace !== null) {
        deltaPace = Math.round((current.averagePace - prior.averagePace) * 100) / 100;
      }
      if (current.averageHeartRate !== null && prior.averageHeartRate !== null) {
        deltaHeartRate = Math.round(current.averageHeartRate - prior.averageHeartRate);
      }
      const currentPower = powerAt140(current.fitness);
      const priorPower = powerAt140(prior.fitness);
      if (currentPower !== null && priorPower !== null) {
        deltaPower140 = currentPower - priorPower;
      }
    }

    weeks.push({
      weekNumber: n,
      phase: currentWeek?.phase ?? priorWeek?.phase ?? null,
      current,
      prior,
      deltaMileage,
      deltaPace,
      deltaHeartRate,
      deltaPower140,
    });
  }

  return {
    currentPlanId: currentPlan.id,
    priorPlanId: priorPlan?.id ?? null,
    totalWeeks: maxWeeks,
    weeks,
    summaries: {
      current: summarizeRows(weeks, "current"),
      prior: priorPlan ? summarizeRows(weeks, "prior") : null,
    },
  };
}

function summarizeRows(weeks: WeekComparisonRow[], which: "current" | "prior"): PlanSummary {
  const actuals = weeks
    .map((row) => (which === "current" ? row.current : row.prior))
    .filter((a): a is WeekActuals => a !== null);

  const plannedMileage = Math.round(
    actuals.reduce((sum, a) => sum + a.plannedMileage, 0) * 10
  ) / 10;
  const actualMileage = Math.round(
    actuals.reduce((sum, a) => sum + a.actualMileage, 0) * 10
  ) / 10;
  const activeWeeks = actuals.filter((a) => a.activeRuns > 0).length;

  // Distance-weighted averages across weeks that have recorded runs.
  const weighted = (pick: (a: WeekActuals) => number | null): number | null => {
    const eligible = actuals.filter((a) => pick(a) !== null && a.actualMileage > 0);
    if (eligible.length === 0) return null;
    const totalDistance = eligible.reduce((sum, a) => sum + a.actualMileage, 0);
    if (totalDistance <= 0) return null;
    return eligible.reduce((sum, a) => sum + (pick(a) as number) * a.actualMileage, 0) / totalDistance;
  };

  const adherenceValues = actuals.map((a) => a.adherence).filter((v): v is number => v !== null);
  const adherence = adherenceValues.length > 0
    ? Math.round(adherenceValues.reduce((sum, v) => sum + v, 0) / adherenceValues.length)
    : null;

  const fitnessBest140 = (() => {
    const values = actuals.map((a) => powerAt140(a.fitness)).filter((v): v is number => v !== null);
    return values.length > 0 ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
  })();

  return {
    weekCount: actuals.length,
    plannedMileage,
    actualMileage,
    activeWeeks,
    averagePace: weighted((a) => a.averagePace),
    averageHeartRate: weighted((a) => a.averageHeartRate),
    averagePower: weighted((a) => a.averagePower),
    averagePowerEstimated: actuals.some((actual) => actual.averagePowerEstimated),
    adherence,
    fitnessBest140,
  };
}

export function formatMiles(miles: number | null): string {
  if (miles === null || !Number.isFinite(miles)) return "--";
  return `${miles.toFixed(1)} mi`;
}

export function formatPaceShort(pace: number | null): string {
  if (pace === null || !Number.isFinite(pace)) return "--";
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatWatts(watts: number | null): string {
  if (watts === null || !Number.isFinite(watts)) return "--";
  return `${Math.round(watts)} W`;
}
