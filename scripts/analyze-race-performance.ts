#!/usr/bin/env node

/** Reports leakage-aware race prediction features and a Riegel baseline backtest. */

import { analyzeRacePerformance } from "../src/lib/analytics/race-performance-analysis";
import { loadPower140Observations } from "../src/lib/analytics/fitness-trajectory";
import {
  findRaceAnalysisUser,
  loadRaceAnalysisDataset,
} from "../src/lib/analytics/race-analysis-loader";
import { endDb } from "../src/lib/db/client";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): void {
  console.error(`Usage:
  npm run race:analyze -- --email runner@example.com [--as-of YYYY-MM-DD] [--lookback-days 112] [--fitness] [--no-effort] [--json]
  npm run race:analyze -- --plan-id UUID [--as-of YYYY-MM-DD] [--lookback-days 112] [--fitness] [--no-effort] [--json]

  --fitness   Enable the experimental Power @ 140 readiness effect (model v2).
              Off by default; v1 (volume + long-run + consistency) is active.
  --no-effort Skip loading samples for time-at-effort training features.

The command is read-only. JSON output is suitable for later model notebooks or scripts.`);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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
const fitnessEnabled = process.argv.includes("--fitness");
const includeEffort = !process.argv.includes("--no-effort");

try {
  if ((!email && !planId) || (email && planId)) {
    usage();
    throw new Error("Provide exactly one of --email or --plan-id");
  }
  if (!validDate(asOf)) throw new Error("--as-of must use YYYY-MM-DD");
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("--lookback-days must be an integer of at least 28");
  }

  const user = await findRaceAnalysisUser({ email, planId });
  if (!user) throw new Error("No matching user or plan found");

  const dataset = await loadRaceAnalysisDataset({
    userId: user.id,
    asOf,
    planId,
    includeTimeAtEffort: includeEffort,
  });
  const fitness = fitnessEnabled ? await loadPower140Observations(user.id, asOf) : [];
  const result = analyzeRacePerformance({
    activities: dataset.activities,
    plans: dataset.plans,
    asOf,
    lookbackDays,
    fitness,
    fitnessEnabled,
  });

  if (json) {
    console.log(JSON.stringify({ user: user.email, ...result }, null, 2));
    await endDb();
    process.exit(0);
  } else {
    console.log(`Race performance analysis for ${user.email} as of ${asOf}`);
    console.table([{ ...result.dataCoverage, timeAtEffortActivities: dataset.timeAtEffortActivities }]);
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
    if (result.trainingAdjustedSummary) {
      console.log("Experimental training-readiness candidate");
      console.table([{
        comparisons: result.trainingAdjustedSummary.comparisons,
        mae: formatDuration(result.trainingAdjustedSummary.meanAbsoluteErrorSeconds),
        meanAbsoluteErrorPercent: result.trainingAdjustedSummary.meanAbsoluteErrorPercent,
        medianAbsoluteErrorPercent: result.trainingAdjustedSummary.medianAbsoluteErrorPercent,
        maxAbsoluteErrorPercent: result.trainingAdjustedSummary.maxAbsoluteErrorPercent,
        rmse: formatDuration(result.trainingAdjustedSummary.rootMeanSquaredErrorSeconds),
        bias: formatDuration(result.trainingAdjustedSummary.biasSeconds),
      }]);
    }
    if (result.trainingAdjustedComparison) {
      console.log("Training candidate versus race-evidence-v1");
      console.table([result.trainingAdjustedComparison]);
    }
    console.log("Forecast-horizon evaluation (candidate versus race-evidence-v1)");
    console.table(result.horizonEvaluations.map((evaluation) => ({
      horizonDays: evaluation.horizonDays,
      comparisons: evaluation.comparison?.commonComparisons ?? 0,
      baseMae: formatDuration(evaluation.base?.meanAbsoluteErrorSeconds ?? null),
      candidateMae: formatDuration(evaluation.candidate?.meanAbsoluteErrorSeconds ?? null),
      baseMeanErrorPercent: evaluation.base?.meanAbsoluteErrorPercent ?? null,
      candidateMeanErrorPercent: evaluation.candidate?.meanAbsoluteErrorPercent ?? null,
      marathonBaseMae: formatDuration(evaluation.marathonBase?.meanAbsoluteErrorSeconds ?? null),
      marathonCandidateMae: formatDuration(evaluation.marathonCandidate?.meanAbsoluteErrorSeconds ?? null),
      wins: evaluation.comparison?.candidateWins ?? 0,
      ties: evaluation.comparison?.ties ?? 0,
      losses: evaluation.comparison?.baseWins ?? 0,
    })));
    if (result.historicalRaces.length > 0) {
      console.log("Historical race feature rows");
      console.table(result.historicalRaces.map((race) => ({
        date: race.raceDate,
        distance: race.distanceLabel,
        actual: formatDuration(race.actualSeconds),
        execution: race.executionQuality ?? "-",
        baseline: formatDuration(race.baseline?.predictedSeconds ?? null),
        forecast: formatDuration(race.forecast?.predictedSeconds ?? null),
        forecastErrorPercent: race.forecastAbsoluteErrorPercent,
        trainingAdjusted: formatDuration(race.trainingAdjustedForecast?.predictedSeconds ?? null),
        trainingAdjustmentPercent: race.trainingAdjustedForecast?.adjustmentPercent ?? null,
        trainingAdjustedErrorPercent: race.trainingAdjustedAbsoluteErrorPercent,
        miles112d: race.training.miles,
        longest: race.training.longestRunMiles,
        activeWeeks: race.training.activeWeeks,
        hrEffortMinutes: race.training.hrEffortMinutes,
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
        trainingAdjusted: formatDuration(target.trainingAdjustedForecast?.predictedSeconds ?? null),
        trainingAdjustmentPercent: target.trainingAdjustedForecast?.adjustmentPercent ?? null,
        forecastRange: target.forecast?.historicalErrorRange
          ? `${formatDuration(target.forecast.historicalErrorRange.lowerSeconds)}-${formatDuration(target.forecast.historicalErrorRange.upperSeconds)}`
          : "insufficient history",
        versusGoal: formatDuration(target.forecastGoalDeltaSeconds),
        trainingAdjustedVersusGoal: formatDuration(target.trainingAdjustedGoalDeltaSeconds),
        evidenceRaces: target.forecast?.evidence.length ?? 0,
        miles112d: target.training.miles,
        longest: target.training.longestRunMiles,
        hrEffortMinutes: target.training.hrEffortMinutes,
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
          execution: evidence.executionQuality ?? "-",
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
  await endDb();
}