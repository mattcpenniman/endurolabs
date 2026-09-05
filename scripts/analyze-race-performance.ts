#!/usr/bin/env node

/** Reports leakage-aware race prediction features and a Riegel baseline backtest. */

import postgres from "postgres";
import {
  analyzeRacePerformance,
  type RaceAnalysisActivity,
  type RaceAnalysisLog,
  type RaceAnalysisPlan,
  type RaceAnalysisPlanRun,
} from "../src/lib/analytics/race-performance-analysis";
import type { MarathonPlan, RunnerProfile, Workout } from "../src/lib/training/models";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const METERS_PER_MILE = 1609.344;
const DISTANCE_METERS = {
  marathon: 42_195,
  half_marathon: 21_097.5,
  "10k": 10_000,
  "5k": 5_000,
} as const;

interface UserRow {
  id: string;
  email: string;
}

interface PlanRow {
  id: string;
  raceName: string | null;
  runnerProfile: RunnerProfile;
  planData: MarathonPlan;
  createdAt: Date;
  updatedAt: Date;
}

interface LogRow {
  planId: string;
  date: string;
  completed: number;
  actualMileage: number;
  loggedAt: Date;
  isAdditionalRun: number;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): void {
  console.error(`Usage:
  npm run race:analyze -- --email runner@example.com [--as-of YYYY-MM-DD] [--lookback-days 112] [--json]
  npm run race:analyze -- --plan-id UUID [--as-of YYYY-MM-DD] [--lookback-days 112] [--json]

The command is read-only. JSON output is suitable for later model notebooks or scripts.`);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function workouts(plan: MarathonPlan): RaceAnalysisPlanRun[] {
  return plan.weeks.flatMap((week) => week.days.flatMap((day) => {
    const values: Workout[] = [day.workout, day.secondaryWorkout].filter(
      (workout): workout is Workout => workout !== null && workout !== undefined,
    );
    return values.map((workout) => ({
      date: day.date.slice(0, 10),
      miles: workout.totalDistance,
      workoutType: workout.type,
    }));
  }));
}

function normalizePlan(row: PlanRow, logs: LogRow[]): RaceAnalysisPlan | null {
  const profile = row.runnerProfile;
  if (typeof profile.raceDate !== "string" || !validDate(profile.raceDate)) return null;
  const raceDistance = profile.raceDistance ?? "marathon";
  const normalizedLogs: RaceAnalysisLog[] = logs
    .filter((log) => log.planId === row.id)
    .map((log) => ({
      date: log.date.slice(0, 10),
      completed: log.completed === 1,
      actualMiles: log.actualMileage / 100,
      loggedAt: log.loggedAt.toISOString(),
      isAdditionalRun: log.isAdditionalRun === 1,
    }));
  return {
    id: row.id,
    raceName: row.raceName ?? profile.raceName ?? null,
    raceDate: profile.raceDate.slice(0, 10),
    raceDistanceMeters: DISTANCE_METERS[raceDistance],
    goalSeconds: raceDistance === "marathon" ? profile.goalMarathonTime * 60 : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    plannedRuns: workouts(row.planData),
    logs: normalizedLogs,
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const sign = seconds < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const email = argument("email");
const planId = argument("plan-id");
const asOf = argument("as-of") ?? new Date().toISOString().slice(0, 10);
const lookbackDays = Number(argument("lookback-days") ?? 112);
const json = process.argv.includes("--json");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  if ((!email && !planId) || (email && planId)) {
    usage();
    throw new Error("Provide exactly one of --email or --plan-id");
  }
  if (!validDate(asOf)) throw new Error("--as-of must use YYYY-MM-DD");
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("--lookback-days must be an integer of at least 28");
  }

  const [user] = await sql<UserRow[]>`
    select u.id, u.email
    from users u
    where ${email ? sql`u.email = ${email}` : sql`u.id = (select user_id from plans where id = ${planId ?? null})`}
    limit 1
  `;
  if (!user) throw new Error("No matching user or plan found");

  const activities = await sql<RaceAnalysisActivity[]>`
    select id, local_date as "localDate", distance_meters as "distanceMeters",
      duration_seconds as "durationSeconds", moving_duration_seconds as "movingDurationSeconds",
      event_type as "eventType", average_heart_rate as "averageHeartRate",
      average_power as "averagePower", calculated_power as "calculatedPower",
      elevation_gain_meters as "elevationGainMeters",
      excluded_from_analytics as "excludedFromAnalytics"
    from run_activities
    where user_id = ${user.id} and local_date::date <= ${asOf}::date
    order by local_date, start_time_gmt
  `;
  const planRows = await sql<PlanRow[]>`
    select id, race_name as "raceName", runner_profile as "runnerProfile",
      plan_data as "planData", created_at as "createdAt", updated_at as "updatedAt"
    from plans
    where user_id = ${user.id}
      and ${planId ? sql`id = ${planId}` : sql`true`}
    order by created_at
  `;
  const logs = planRows.length === 0 ? [] : await sql<LogRow[]>`
    select plan_id as "planId", date, completed, actual_mileage_hundredths as "actualMileage",
      logged_at as "loggedAt", is_additional_run as "isAdditionalRun"
    from plan_run_logs
    where plan_id in ${sql(planRows.map((plan) => plan.id))}
    order by date, logged_at
  `;
  const plans = planRows
    .map((plan) => normalizePlan(plan, logs))
    .filter((plan): plan is RaceAnalysisPlan => plan !== null);
  const result = analyzeRacePerformance({ activities, plans, asOf, lookbackDays });

  if (json) {
    console.log(JSON.stringify({ user: user.email, ...result }, null, 2));
  } else {
    console.log(`Race performance analysis for ${user.email} as of ${asOf}`);
    console.table([result.dataCoverage]);
    if (result.baselineSummary) {
      console.log("Historical Riegel baseline");
      console.table([{
        comparisons: result.baselineSummary.comparisons,
        mae: formatDuration(result.baselineSummary.meanAbsoluteErrorSeconds),
        maePercent: result.baselineSummary.meanAbsoluteErrorPercent,
        rmse: formatDuration(result.baselineSummary.rootMeanSquaredErrorSeconds),
        bias: formatDuration(result.baselineSummary.biasSeconds),
      }]);
    } else {
      console.log("Historical Riegel baseline: insufficient prior race pairs");
    }
    if (result.forecastSummary) {
      console.log("Historical distance-aware forecast");
      console.table([{
        comparisons: result.forecastSummary.comparisons,
        mae: formatDuration(result.forecastSummary.meanAbsoluteErrorSeconds),
        meanAbsoluteErrorPercent: result.forecastSummary.meanAbsoluteErrorPercent,
        medianAbsoluteErrorPercent: result.forecastSummary.medianAbsoluteErrorPercent,
        maxAbsoluteErrorPercent: result.forecastSummary.maxAbsoluteErrorPercent,
        rmse: formatDuration(result.forecastSummary.rootMeanSquaredErrorSeconds),
        bias: formatDuration(result.forecastSummary.biasSeconds),
      }]);
    }
    if (result.forecastComparison) {
      console.log("Common-sample model comparison");
      console.table([result.forecastComparison]);
    }
    if (result.historicalRaces.length > 0) {
      console.log("Historical race feature rows");
      console.table(result.historicalRaces.map((race) => ({
        date: race.raceDate,
        distance: race.distanceLabel,
        actual: formatDuration(race.actualSeconds),
        baseline: formatDuration(race.baseline?.predictedSeconds ?? null),
        forecast: formatDuration(race.forecast?.predictedSeconds ?? null),
        forecastErrorPercent: race.forecastAbsoluteErrorPercent,
        miles112d: race.training.miles,
        longest: race.training.longestRunMiles,
        activeWeeks: race.training.activeWeeks,
        planAdherence: race.plan?.workoutCompletionPercent ?? null,
      })));
    }
    if (result.planTargets.length > 0) {
      console.log("Current plan targets");
      console.table(result.planTargets.map((target) => ({
        race: target.raceName ?? target.distanceLabel,
        date: target.raceDate,
        goal: formatDuration(target.goalSeconds),
        baseline: formatDuration(target.baseline?.predictedSeconds ?? null),
        forecast: formatDuration(target.forecast?.predictedSeconds ?? null),
        forecastRange: target.forecast?.historicalErrorRange
          ? `${formatDuration(target.forecast.historicalErrorRange.lowerSeconds)}-${formatDuration(target.forecast.historicalErrorRange.upperSeconds)}`
          : "insufficient history",
        versusGoal: formatDuration(target.forecastGoalDeltaSeconds),
        evidenceRaces: target.forecast?.evidence.length ?? 0,
        miles112d: target.training.miles,
        longest: target.training.longestRunMiles,
        planAdherence: target.plan.workoutCompletionPercent,
      })));
      for (const target of result.planTargets) {
        if (!target.forecast) continue;
        console.log(`${target.raceName ?? target.distanceLabel} forecast evidence`);
        console.table(target.forecast.evidence.map((evidence) => ({
          date: evidence.raceDate,
          distance: evidence.distanceLabel,
          result: formatDuration(evidence.actualSeconds),
          equivalent: formatDuration(evidence.equivalentSeconds),
          ageDays: evidence.ageDays,
          weight: evidence.combinedWeight,
        })));
      }
    }
    console.log("Warnings");
    for (const warning of result.warnings) console.log(`- ${warning}`);
    console.log("Use --json for complete machine-readable feature rows.");
  }
} catch (error) {
  console.error("Race performance analysis failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
