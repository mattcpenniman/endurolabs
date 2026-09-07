#!/usr/bin/env node

/** Issues scheduled snapshots, or an ad hoc snapshot for one plan. */

export {};

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const { issueDueRacePredictionSnapshots, issueRacePredictionSnapshotForPlan } = await import(
  "../src/lib/analytics/race-prediction-scheduler"
);
const planIndex = process.argv.indexOf("--plan-id");
const planId = planIndex >= 0 ? process.argv[planIndex + 1] : null;

if (planId) {
  const snapshotId = await issueRacePredictionSnapshotForPlan(planId);
  console.log(snapshotId ? `Issued snapshot ${snapshotId}` : "Snapshot already exists or no evidence is available");
} else {
  console.log(await issueDueRacePredictionSnapshots());
}
process.exit(0);
