#!/usr/bin/env node

// ============================================================
// EnduroLab — Recommend Training Plan CLI
// ============================================================
// Read-only analysis: forecast, goal gap, training state,
// limiting factors, recommendations, gates.
//
// --create generates a fresh plan for a target race from the
// athlete's stored profile; --apply persists it (preview-first).
// ============================================================

try { process.loadEnvFile('.env'); } catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { parseGoalTime, parseDistance, type ParsedGoal, type PlannerPlanData } from '@/lib/planner/models';
import { buildAthleteSnapshot } from '@/lib/planner/athlete-snapshot';
import { computeGoalGap, identifyLimiters } from '@/lib/planner/goal-gap';
import { runSafetyGates } from '@/lib/planner/safety-gates';
import { buildRecommendations, formatReport } from '@/lib/planner/recommendations';
import {
  buildCreateProfile,
  summarizePlan,
  validateCreateOptions,
  validatePlanCalendar,
  type CreatePlanOptions,
} from '@/lib/planner/plan-creation';
import { generatePlan } from '@/lib/training/plan-generator';
import type { MarathonPlan, RunnerProfile } from '@/lib/training/models';
import type { RaceAnalysisActivity } from '@/lib/analytics/race-performance-analysis';

// ─── Arg helpers ──────────────────────────────────────────────

const argv = process.argv.slice(2);

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const planId = argument('plan-id') ?? undefined;
const email = argument('email');
const distance = argument('distance') ?? 'marathon';
const goalTimeStr = argument('goal');
const asOfStr = argument('as-of') ?? new Date().toISOString().slice(0, 10);
const jsonOnly = argv.includes('--json');

const createMode = argv.includes('--create');
const applyMode = argv.includes('--apply');
const setCurrent = argv.includes('--set-current');
const noDoubles = argv.includes('--no-doubles');
const resetWeeklyOverrides = argv.includes('--reset-weekly-overrides');
const raceName = argument('race-name') ?? argument('name');
const raceDate = argument('race-date');
const weeksArg = argument('weeks');
const daysArg = argument('days');
const longRunDay = argument('long-run-day');
const maxWeeklyArg = argument('max-weekly-mileage');
const maxLongArg = argument('max-long-run');
const todayStr = new Date().toISOString().slice(0, 10);

if ((!email && !planId) || (email && planId)) {
  console.error('Error: provide exactly one of --plan-id or --email');
  process.exit(1);
}

if (applyMode && !createMode) {
  console.error('Error: --apply currently requires --create (--adjust is not implemented)');
  process.exit(1);
}

const parsedDist = parseDistance(distance);
if (!parsedDist) {
  console.error(`Error: unrecognized distance "${distance}"`);
  process.exit(1);
}

let parsedGoal: ParsedGoal | null = null;
if (goalTimeStr) {
  const goalMinutes = parseGoalTime(goalTimeStr);
  if (goalMinutes == null) {
    console.error(`Error: invalid goal time "${goalTimeStr}". Use H:MM:SS.`);
    process.exit(1);
  }
  parsedGoal = { goalMinutes, distanceMeters: parsedDist.meters, distanceLabel: parsedDist.label };
}

let createOptions: CreatePlanOptions | null = null;
if (createMode) {
  if (parsedDist.label !== 'Marathon') {
    console.error('Error: --create currently supports marathon plans only (--distance marathon)');
    process.exit(1);
  }
  if (!raceDate) {
    console.error('Error: --create requires --race-date YYYY-MM-DD');
    process.exit(1);
  }
  if (!parsedGoal) {
    console.error('Error: --create requires --goal H:MM:SS');
    process.exit(1);
  }

  createOptions = {
    raceDate,
    goalMinutes: parsedGoal.goalMinutes,
    raceName,
    weeks: weeksArg === undefined ? undefined : Number(weeksArg),
    maxWeeklyMileage: maxWeeklyArg === undefined ? undefined : Number(maxWeeklyArg),
    maxLongRun: maxLongArg === undefined ? undefined : Number(maxLongArg),
    trainingDays: daysArg === undefined ? undefined : daysArg.split(',').map((day) => day.trim()).filter(Boolean).length,
    longRunDay,
    noDoubles,
    resetWeeklyOverrides,
  };

  const optionErrors = validateCreateOptions(createOptions, todayStr);
  if (optionErrors.length > 0) {
    for (const error of optionErrors) console.error(`Error: ${error}`);
    process.exit(1);
  }
}

// ─── DB helpers ──────────────────────────────────────────────

function secondsToHMS(secs: number): string {
  const totalSecs = Math.max(0, Math.round(secs));
  const sign = secs < 0 ? '-' : '';
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Shared row types ────────────────────────────────────────

interface UserRow { id: string; email: string }
interface PlanRow {
  id: string; raceName: string | null; runnerProfile: RunnerProfile; planData: MarathonPlan; createdAt: Date; updatedAt: Date;
}
interface ActivityRaw {
  id: string; localDate: string; distanceMeters: number; durationSeconds: number;
  movingDurationSeconds: number | null; eventType: string | null; averageHeartRate: number | null;
  averagePower: number | null; calculatedPower: number | null; elevationGainMeters: number | null;
  excludedFromAnalytics: boolean;
}

// ─── Create mode ─────────────────────────────────────────────

/** postgres.js serializes JSONB via sql.json(); plain objects are not JSONValue by default. */
function toJson(value: unknown): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

interface CreatePlanContext {
  sql: postgres.Sql;
  user: UserRow;
  basePlan: PlanRow;
  planData: PlannerPlanData;
  snapshot: ReturnType<typeof buildAthleteSnapshot>;
  options: CreatePlanOptions;
  goal: ParsedGoal;
  apply: boolean;
  setCurrent: boolean;
  jsonOnly: boolean;
  today: string;
}

async function runCreatePlan(context: CreatePlanContext): Promise<void> {
  const { sql, user, basePlan, planData, snapshot, options, goal, apply, setCurrent, jsonOnly, today } = context;

  const baseProfile = basePlan.planData.runnerProfile ?? basePlan.runnerProfile;
  const profile = buildCreateProfile(baseProfile, options);
  const plan = generatePlan(profile);
  const summary = summarizePlan(plan);
  const calendarGates = validatePlanCalendar(plan, today, options.raceDate);
  const safetyGates = runSafetyGates(plan, snapshot, {
    maxWeeklyMileage: options.maxWeeklyMileage,
    maxLongRun: options.maxLongRun,
    longRunDay: options.longRunDay,
    noDoubles: options.noDoubles,
  });
  const gates = [...calendarGates, ...safetyGates];
  const refusals = gates.filter((gate) => gate.result === 'refuse');
  const forecast = computeGoalGap(planData, goal);

  let planId: string | null = null;
  if (apply) {
    if (refusals.length > 0) {
      console.error('Refusing to apply — calendar or safety gates failed:');
      for (const refusal of refusals) console.error(`  [REFUSE] ${refusal.checkId}: ${refusal.message}`);
      process.exitCode = 1;
      return;
    }

    const newPlanId = randomUUID();
    const persistedPlan: MarathonPlan = { ...plan, id: newPlanId };
    await sql.begin(async (tx) => {
      await tx`
        insert into plans (id, user_id, runner_profile, peak_mileage_override, weeks_override, plan_data, race_name)
        values (${newPlanId}, ${user.id}, ${tx.json(toJson(profile))}, ${profile.peakMileageOverride ?? null}, ${profile.weeksOverride ?? null}, ${tx.json(toJson(persistedPlan))}, ${options.raceName ?? null})
      `;
      if (setCurrent) {
        await tx`update users set current_plan_id = ${newPlanId}, updated_at = now() where id = ${user.id}`;
      }
    });
    planId = newPlanId;
  }

  const appUrl = process.env.APP_URL?.replace(/\/$/, '');

  if (jsonOnly) {
    console.log(JSON.stringify({
      version: 'planner-v1-alpha',
      mode: apply ? 'applied' : 'preview',
      planId,
      athlete: user.email,
      basePlanId: basePlan.id,
      raceName: options.raceName ?? null,
      raceDate: options.raceDate,
      goal: { minutes: options.goalMinutes, seconds: Math.round(options.goalMinutes * 60) },
      profile,
      forecast,
      summary,
      calendarGates,
      safetyGates,
    }, null, 2));
    return;
  }

  const start = summary.startDate.slice(0, 10);
  const end = summary.endDate.slice(0, 10);
  const gapSeconds = Math.abs(forecast.gapSeconds);
  const gapDirection = forecast.gapSeconds > 0 ? 'behind' : forecast.gapSeconds < 0 ? 'ahead of' : 'on';

  console.log(`=== EnduroLab Plan ${apply ? 'Create' : 'Create Preview'} ===`);
  console.log(`Athlete:     ${user.email}`);
  console.log(`Base plan:   ${basePlan.id}${basePlan.raceName ? ` (${basePlan.raceName})` : ''}`);
  console.log(`Race:        ${options.raceName ?? 'Target race'} on ${options.raceDate}`);
  console.log(`Goal:        ${secondsToHMS(options.goalMinutes * 60)} marathon`);
  console.log(`Calendar:    ${plan.totalWeeks} weeks, ${start} → ${end}`);
  console.log(`Volume:      peak ${summary.peakWeeklyMileage} mi, total ${summary.totalMileage} mi, ${summary.downWeeks}/${plan.totalWeeks} down weeks`);
  console.log(`Phases:      ${summary.phases.map((phase) => `${phase.name} w${phase.startWeek}-${phase.endWeek}`).join(', ')}`);
  console.log(`Weekly mi:   ${summary.weeks.map((week) => week.miles).join(' ')}`);
  console.log(`Long runs:   ${summary.weeks.map((week) => week.longRunMiles).join(' ')}`);
  console.log(`Feasibility: ${summary.feasibility} — ${plan.goalAssessment.reasoning}`);
  console.log(`Forecast:    ${secondsToHMS(forecast.predictedSeconds)} today; goal is ${forecast.classification} (${secondsToHMS(gapSeconds)} ${gapDirection} goal)`);

  console.log('\nGates:');
  for (const gate of gates) {
    console.log(`  [${gate.result.toUpperCase().padEnd(6)}] ${gate.checkId}: ${gate.message}`);
  }

  if (plan.riskWarnings.length > 0) {
    console.log('\nRisk warnings:');
    for (const warning of plan.riskWarnings) console.log(`  - ${warning}`);
  }

  if (apply) {
    console.log(`\nCreated plan ${planId}${setCurrent ? ' and set it as the current plan' : ''}.`);
    if (appUrl) console.log(`Open: ${appUrl}/plan`);
  } else {
    console.log('\nNot persisted. Re-run with --apply to create the plan.');
  }
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://enduro:endurodev@localhost:5432/endurolab';
  const sql = postgres(databaseUrl, { prepare: false });

  // Resolve user
  const [user] = await sql<UserRow[]>`
    select u.id, u.email from users u
    where ${email ? sql`u.email = ${email}` : sql`u.id = (select user_id from plans where id = ${planId ?? null})`}
    limit 1
  `;
  if (!user) throw new Error('No matching user or plan found');

  const [dbPlan] = planId
    ? await sql<PlanRow[]>`
        select id, race_name as "raceName", runner_profile as "runnerProfile",
          plan_data as "planData", created_at as "createdAt", updated_at as "updatedAt"
        from plans where id = ${planId} limit 1
      `
    : await sql<PlanRow[]>`
        select id, race_name as "raceName", runner_profile as "runnerProfile",
          plan_data as "planData", created_at as "createdAt", updated_at as "updatedAt"
        from plans where user_id = ${user.id} order by updated_at desc limit 1
      `;

  if (!dbPlan) throw new Error('No plan found');

  // Activities before cutoff — include canonical race results as activity rows
  const activityRows = await sql<ActivityRaw[]>`
    select id, local_date as "localDate", distance_meters as "distanceMeters",
      duration_seconds as "durationSeconds", moving_duration_seconds as "movingDurationSeconds",
      event_type as "eventType", average_heart_rate as "averageHeartRate",
      average_power as "averagePower", calculated_power as "calculatedPower",
      elevation_gain_meters as "elevationGainMeters", excluded_from_analytics as "excludedFromAnalytics"
    from run_activities where user_id = ${user.id} and local_date <= ${asOfStr}
  `;

  const activities: RaceAnalysisActivity[] = activityRows.map(a => ({
    id: a.id, localDate: String(a.localDate), distanceMeters: Number(a.distanceMeters) || 0,
    durationSeconds: Number(a.durationSeconds) || 0, movingDurationSeconds: a.movingDurationSeconds != null ? Number(a.movingDurationSeconds) : null,
    eventType: a.eventType ?? null, averageHeartRate: a.averageHeartRate != null ? Number(a.averageHeartRate) : null,
    averagePower: a.averagePower != null ? Number(a.averagePower) : null,
    calculatedPower: a.calculatedPower != null ? Number(a.calculatedPower) : null,
    elevationGainMeters: a.elevationGainMeters != null ? Number(a.elevationGainMeters) : null,
    excludedFromAnalytics: Boolean(a.excludedFromAnalytics),
  }));

  const planP = dbPlan.planData;

  // Build snapshot / gap / limiters / recommendations / safety gates
  const planData: PlannerPlanData = {
    plan: planP as MarathonPlan, activities, fitnessObservations: [], logs: [],
    asOf: asOfStr, sourceMaxTimestamp: asOfStr,
  };

  const snapshot = buildAthleteSnapshot(planData);

  if (createMode && createOptions && parsedGoal) {
    await runCreatePlan({
      sql, user, basePlan: dbPlan, planData, snapshot,
      options: createOptions, goal: parsedGoal,
      apply: applyMode, setCurrent, jsonOnly, today: todayStr,
    });
    await sql.end();
    return;
  }

  // Determine goal minutes (CLI flag > plan runner profile)
  const goalMinutes = parsedGoal?.goalMinutes ?? planP.runnerProfile?.goalMarathonTime ?? null;

  if (goalMinutes == null) {
    console.error('Error: no goal time. Provide --goal or ensure plan has a goal.');
    process.exit(1);
  }

  const finalGoal: ParsedGoal = parsedGoal ?? {
    goalMinutes, distanceMeters: 42195, distanceLabel: 'Marathon',
  };

  const goalGap = computeGoalGap(planData, finalGoal);
  const limiters = identifyLimiters(
    {
      consistencyRate: snapshot.consistencyRate,
      peakWeeklyMiles: snapshot.peakWeeklyMiles,
      trainingFeatures: {
        milesLast28Days: snapshot.trainingFeatures.milesLast28Days,
        longestRunMiles: snapshot.trainingFeatures.longestRunMiles,
        runsAtLeast12Miles: snapshot.trainingFeatures.runsAtLeast12Miles,
        runsAtLeast14Miles: snapshot.trainingFeatures.runsAtLeast14Miles,
        missingWeeks: snapshot.trainingFeatures.missingWeeks,
        longestTrainingGapDays: snapshot.trainingFeatures.longestTrainingGapDays,
        activeWeeks: snapshot.trainingFeatures.activeWeeks,
        peakWeeklyMiles: snapshot.peakWeeklyMiles,
      },
      injuryFlags: snapshot.injuryFlags,
      feelTrend: snapshot.feelTrend,
    },
    goalMinutes,
    finalGoal.distanceMeters,
  );

  const recs = buildRecommendations(snapshot, planP as MarathonPlan, goalMinutes);
  const safety = runSafetyGates(planP as any, snapshot, {});

  // ─── Output ──────────────────────────────────────────────

  if (jsonOnly) {
    console.log(JSON.stringify({
      version: 'planner-v1-alpha',
      planId: dbPlan.id,
      asOf: asOfStr,
      parsedGoal: finalGoal,
      snapshot: {
        sourceMaxTimestamp: snapshot.sourceMaxTimestamp,
        asOf: snapshot.asOf,
        trainingFeatures: snapshot.trainingFeatures,
        fitnessTrend: snapshot.fitnessTrend,
        injuryFlags: snapshot.injuryFlags,
        feelTrend: snapshot.feelTrend,
        consistencyRate: snapshot.consistencyRate,
        peakWeeklyMiles: snapshot.peakWeeklyMiles,
        weightedAvgPower: snapshot.weightedAvgPower,
      },
      goalGap,
      limiters,
      recommendations: recs,
      safetyGates: safety,
    }, null, 2));
  } else {
    const gapMin = Math.abs(goalGap.gapSeconds / 60);
    const dirText = goalGap.predictedSeconds > goalGap.goalSeconds
      ? 'behind' : goalGap.predictedSeconds < goalGap.goalSeconds
      ? 'ahead of' : 'on target';

    console.log('=== EnduroLab Planner Analysis ===');
    console.log(`Plan: ${dbPlan.id} | Race: ${dbPlan.raceName || 'Unnamed'} on ${planP.runnerProfile?.raceDate || '?'}`);
    console.log(`As-of: ${asOfStr}`);
    console.log('');
    console.log(`Goal: ${secondsToHMS(goalGap.goalSeconds)} (predicted: ${secondsToHMS(goalGap.predictedSeconds)})`);
    console.log(`Gap: ${secondsToHMS(goalGap.gapSeconds)} ${dirText} goal [${goalGap.classification}]`);

    if (goalGap.rangeLow != null && goalGap.rangeHigh != null) {
      console.log(`90% historical range: ${secondsToHMS(goalGap.rangeLow)} – ${secondsToHMS(goalGap.rangeHigh)}`);
    }
    console.log(`Evidence: ${goalGap.evidenceCount} race(s) (${goalGap.dataConfidence} confidence)`);

    const tf = snapshot.trainingFeatures;
    console.log('\nTraining State:');
    console.log(`  28-day avg mileage: ${tf.milesLast28Days.toFixed(1)} mi`);
    console.log(`  Consistency: ${(snapshot.consistencyRate * 100).toFixed(0)}%`);
    console.log(`  Peak weekly: ${snapshot.peakWeeklyMiles.toFixed(1)} mi | Longest run: ${tf.longestRunMiles.toFixed(1)} mi`);
    console.log(`  Fitness trend: ${snapshot.fitnessTrend}`);

    console.log('\n' + formatReport(recs, limiters));

    const refusals = safety.filter(s => s.result === 'refuse');
    const warnings = safety.filter(s => s.result === 'warn');

    if (refusals.length) {
      console.log('\nCritical safety gates failed:');
      for (const r of refusals) console.log(`  [REFUSE] ${r.message}`);
    }
    if (warnings.length) {
      console.log('\nWarnings:');
      for (const w of warnings) console.log(`  [WARN] ${w.message}`);
    }

    console.log('\nThis forecast is evidence-based, not calibrated. Changes are intended adaptations.');
  }

  await sql.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
