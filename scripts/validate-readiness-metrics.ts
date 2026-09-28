#!/usr/bin/env node

/** Ranks readiness metrics with the rolling-origin race backtest and
 *  athlete-held-out folds, and reports the promotion decision. Read-only. */

import {
  evaluateReadinessMetrics,
  readinessPromotionTiers,
  type ReadinessMetricsReport,
} from "../src/lib/analytics/readiness-metrics";
import type { RaceAnalysisActivity } from "../src/lib/analytics/race-performance-analysis";
import {
  findRaceAnalysisUser,
  listRaceAnalysisUsers,
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
  npm run readiness:validate -- [--email runner@example.com] [--as-of YYYY-MM-DD] [--lookback-days 112] [--horizons 7,28,84] [--json]

  Without --email every athlete with race history is loaded and validated
  together, which is what enables athlete-held-out folds.

  Reports pooled MAE/RMSE/bias per candidate metric, runs forward selection
  under the fixed promotion policy, and prints the resulting beacon whitelist.
  The command is read-only.`);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

interface LoadedSubject {
  athleteId: string;
  activities: RaceAnalysisActivity[];
  timeAtEffortActivities: number;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "-";
  const sign = seconds < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function printReport(report: ReadinessMetricsReport, subjectLabel: string): void {
  const base = report.base.summary;
  console.log(`Readiness metric validation (${report.version}) for ${subjectLabel} as of ${report.asOf}`);
  console.table([{
    subjects: report.subjects,
    races: report.races,
    pairs: report.pairs,
    lookbackDays: report.lookbackDays,
    horizons: report.horizons.join("/"),
  }]);
  console.log("Base race-evidence-v1");
  console.table([{
    comparisons: report.base.comparisons,
    mae: formatDuration(base?.meanAbsoluteErrorSeconds),
    maePercent: formatPercent(base?.meanAbsoluteErrorPercent),
    rmse: formatDuration(base?.rootMeanSquaredErrorSeconds),
    bias: formatDuration(base?.biasSeconds),
    medianAbsoluteErrorPercent: formatPercent(base?.medianAbsoluteErrorPercent),
    maxAbsoluteErrorPercent: formatPercent(base?.maxAbsoluteErrorPercent),
  }]);
  console.log(report.athleteHeldOut.available
    ? `Athlete-held-out folds: ${report.athleteHeldOut.folds.length}, improved share ${formatPercent((report.athleteHeldOut.improvedFoldShare ?? 0) * 100)}, median MAE improvement ${formatDuration(report.athleteHeldOut.medianFoldMaeImprovementSeconds)}, validated ${report.athleteHeldOut.validated}`
    : "Athlete-held-out folds: unavailable (fewer than two athletes with race history)");

  console.log("Metric ranking (race-evidence-v1 + one metric; promoted first, by MAE)");
  console.table(report.ranking.map((entry) => ({
    rank: entry.rank ?? "-",
    promotion: entry.promotion,
    metric: entry.metric,
    coverage: formatPercent(entry.coverageShare * 100),
    comparisons: entry.standalone.comparisons,
    mae: formatDuration(entry.standalone.summary?.meanAbsoluteErrorSeconds),
    maeImprovement: formatDuration(entry.maeImprovementSeconds),
    relativeImprovementPercent: formatPercent(entry.relativeMaeImprovement),
    rmse: formatDuration(entry.standalone.summary?.rootMeanSquaredErrorSeconds),
    bias: formatDuration(entry.standalone.summary?.biasSeconds),
    medianAbsoluteErrorPercent: formatPercent(entry.standalone.summary?.medianAbsoluteErrorPercent),
    wins: entry.standalone.comparison?.candidateWins ?? 0,
    ties: entry.standalone.comparison?.ties ?? 0,
    losses: entry.standalone.comparison?.baseWins ?? 0,
    reasons: entry.reasons.join("; ") || "passes",
  })));

  console.log("Forward selection under the promotion policy");
  console.log(`Promoted: ${report.promoted.join(", ") || "(none)"}; incremental subset: ${report.incrementalSelection.join(", ") || "(none)"}`);
  if (report.forwardSelection.length === 0) {
    console.log("No metric improved the incumbent set enough to be promoted incrementally.");
  } else {
    console.table(report.forwardSelection.map((step) => ({
      step: step.step,
      metric: step.metric,
      metrics: step.metrics.join("+"),
      maeImprovement: formatDuration(step.maeImprovementSeconds),
      relativeMaeImprovementPercent: formatPercent(step.relativeMaeImprovement),
      medianImproved: step.medianImproved,
      wins: step.wins,
      ties: step.ties,
      losses: step.losses,
      coverage: formatPercent(step.coverageShare * 100),
    })));
  }
  const tiers = readinessPromotionTiers(report);
  console.log("Beacon whitelist");
  console.table(report.ranking.map((entry) => ({
    metric: entry.metric,
    promotion: tiers[entry.metric],
    inBeacon: tiers[entry.metric] !== "rejected",
  })));
  console.log("Warnings");
  for (const warning of report.warnings) console.log(`- ${warning}`);
  console.log("Use --json for the complete machine-readable report.");
}

const email = argument("email");
const asOf = argument("as-of") ?? new Date().toISOString().slice(0, 10);
const lookbackDays = Number(argument("lookback-days") ?? 112);
const horizons = (argument("horizons") ?? "7,28,84")
  .split(",")
  .map((value) => Number(value.trim()));
const json = process.argv.includes("--json");

try {
  if (!validDate(asOf)) throw new Error("--as-of must use YYYY-MM-DD");
  if (!Number.isInteger(lookbackDays) || lookbackDays < 28) {
    throw new Error("--lookback-days must be an integer of at least 28");
  }
  if (horizons.length === 0 || horizons.some((h) => !Number.isInteger(h) || h < 0 || h > 365)) {
    throw new Error("--horizons must be comma-separated integers between 0 and 365");
  }

  const users = email
    ? [await findRaceAnalysisUser({ email })]
    : await listRaceAnalysisUsers();
  const resolved = users.filter((user): user is NonNullable<typeof user> => user !== null);
  if (resolved.length === 0) throw new Error("No matching athlete with race history found");

  const subjects: LoadedSubject[] = [];
  for (const user of resolved) {
    const dataset = await loadRaceAnalysisDataset({
      userId: user.id,
      asOf,
      includeTimeAtEffort: true,
    });
    subjects.push({
      athleteId: user.email,
      activities: dataset.activities,
      timeAtEffortActivities: dataset.timeAtEffortActivities,
    });
  }

  const report = evaluateReadinessMetrics({
    subjects: subjects.map((subject) => ({
      athleteId: subject.athleteId,
      activities: subject.activities,
    })),
    asOf,
    lookbackDays,
    horizons,
  });

  if (json) {
    console.log(JSON.stringify({
      users: subjects.map((subject) => ({
        email: subject.athleteId,
        activities: subject.activities.length,
        timeAtEffortActivities: subject.timeAtEffortActivities,
      })),
      ...report,
    }, null, 2));
  } else {
    printReport(report, subjects.map((subject) => subject.athleteId).join(", "));
  }
} catch (error) {
  console.error("Readiness metric validation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await endDb();
}