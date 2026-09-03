#!/usr/bin/env node

// Recomputes persisted activity summary metrics and detail-v1 quality scores
// from existing activity_samples. This command does not contact Garmin.

import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const email = argument("email");
const dryRun = process.argv.includes("--dry-run");
const sql = postgres(databaseUrl, { prepare: false });

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function ratio(count, total) {
  return total > 0 ? count / total : 0;
}

function steadyStateShare(samples) {
  const buckets = new Map();
  for (const sample of samples) {
    if (
      sample.speed === null || sample.speed < 1.8
      || sample.heartRate === null || sample.heartRate < 90 || sample.heartRate > 200
      || sample.power === null || sample.power < 80 || sample.power > 700
    ) continue;
    const bucket = Math.floor(sample.elapsedSeconds / 30);
    const powers = buckets.get(bucket) ?? [];
    powers.push(sample.power);
    buckets.set(bucket, powers);
  }
  const populated = [...buckets.values()].filter((powers) => powers.length >= 10);
  if (populated.length === 0) return 0;
  const steady = populated.filter((powers) => {
    const mean = powers.reduce((sum, power) => sum + power, 0) / powers.length;
    const variance = powers.reduce((sum, power) => sum + (power - mean) ** 2, 0) / powers.length;
    return mean > 0 && Math.sqrt(variance) / mean <= 0.15;
  });
  return steady.length / populated.length;
}

function qualityScore(samples, durationSeconds) {
  if (samples.length === 0) return 0;
  const lastElapsed = samples.at(-1)?.elapsedSeconds ?? 0;
  const traceCoverage = durationSeconds > 0 ? Math.min(lastElapsed / durationSeconds, 1) : 0;
  const durationSuitability = Math.min(Math.max(durationSeconds, 0) / 1200, 1);
  const score =
    ratio(samples.filter((sample) => sample.heartRate !== null).length, samples.length) * 25
    + ratio(samples.filter((sample) => sample.power !== null).length, samples.length) * 25
    + ratio(samples.filter((sample) => sample.latitude !== null && sample.longitude !== null).length, samples.length) * 10
    + traceCoverage * durationSuitability * 15
    + steadyStateShare(samples) * 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function timeWeightedAverage(samples, key, valid) {
  let weightedTotal = 0;
  let totalSeconds = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const value = samples[index][key];
    const seconds = Math.min(Math.max(samples[index + 1].elapsedSeconds - samples[index].elapsedSeconds, 0), 60);
    if (value === null || !valid(value) || seconds === 0) continue;
    weightedTotal += value * seconds;
    totalSeconds += seconds;
  }
  return totalSeconds > 0 ? Math.round(weightedTotal / totalSeconds) : null;
}

function deriveSummary(samples, originalDuration) {
  if (samples.length === 0) return null;
  const firstElapsed = samples[0].elapsedSeconds;
  const durationSeconds = Math.round(samples.at(-1).elapsedSeconds);
  const complete = firstElapsed <= 5
    && originalDuration > 0
    && durationSeconds / originalDuration >= 0.95;
  if (!complete) return null;

  let movingDurationSeconds = 0;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const seconds = Math.min(Math.max(samples[index + 1].elapsedSeconds - samples[index].elapsedSeconds, 0), 60);
    if ((samples[index].speed ?? 0) >= 0.5) movingDurationSeconds += seconds;
  }
  const distances = samples.map((sample) => sample.distanceMeters).filter((value) => value !== null && value >= 0);
  const heartRates = samples.map((sample) => sample.heartRate).filter((value) => value !== null && value >= 30 && value <= 250);

  return {
    distanceMeters: distances.length > 0 ? Math.round(Math.max(...distances)) : null,
    durationSeconds,
    movingDurationSeconds: Math.min(Math.round(movingDurationSeconds), durationSeconds),
    averageHeartRate: timeWeightedAverage(samples, "heartRate", (value) => value >= 30 && value <= 250),
    maxHeartRate: heartRates.length > 0 ? Math.max(...heartRates) : null,
    averagePower: timeWeightedAverage(samples, "power", (value) => value >= 0 && value <= 2000),
    averageCadence: timeWeightedAverage(samples, "cadence", (value) => value >= 0 && value <= 300),
  };
}

try {
  const [user] = await sql`
    select u.id, u.email
    from users u
    where ${email ? sql`u.email = ${email}` : sql`exists (
      select 1 from run_activities a where a.user_id = u.id and a.source = 'garmin'
    )`}
    order by u.created_at
    limit 1
  `;
  if (!user) throw new Error(email ? `No user found for ${email}` : "No user with Garmin activities found");

  const activities = await sql`
    select id, provider_activity_id as "providerActivityId", duration_seconds as "durationSeconds"
    from run_activities
    where user_id = ${user.id} and source = 'garmin' and samples_fetched_at is not null
    order by start_time_gmt
  `;
  let summariesUpdated = 0;
  let qualityOnly = 0;
  let empty = 0;

  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index];
    const samples = await sql`
      select elapsed_seconds as "elapsedSeconds", distance_meters as "distanceMeters",
        heart_rate as "heartRate", power, speed_meters_per_second as speed,
        cadence, latitude, longitude
      from activity_samples
      where activity_id = ${activity.id}
      order by elapsed_seconds
    `;
    const quality = qualityScore(samples, activity.durationSeconds);
    const summary = deriveSummary(samples, activity.durationSeconds);
    if (samples.length === 0) empty += 1;
    else if (summary) summariesUpdated += 1;
    else qualityOnly += 1;

    if (!dryRun) {
      if (summary) {
        await sql`update run_activities set
          distance_meters = coalesce(${summary.distanceMeters}, distance_meters),
          duration_seconds = ${summary.durationSeconds},
          moving_duration_seconds = ${summary.movingDurationSeconds},
          average_heart_rate = coalesce(${summary.averageHeartRate}, average_heart_rate),
          max_heart_rate = coalesce(${summary.maxHeartRate}, max_heart_rate),
          average_power = coalesce(${summary.averagePower}, average_power),
          average_cadence = coalesce(${summary.averageCadence}, average_cadence),
          sample_count = ${samples.length}, quality_score = ${quality}, updated_at = now()
          where id = ${activity.id}`;
      } else {
        await sql`update run_activities set sample_count = ${samples.length},
          quality_score = ${quality}, updated_at = now() where id = ${activity.id}`;
      }
    }
    if ((index + 1) % 50 === 0 || index + 1 === activities.length) {
      console.log(`[${index + 1}/${activities.length}] summaries=${summariesUpdated} quality-only=${qualityOnly} empty=${empty}`);
    }
  }

  console.log(JSON.stringify({
    user: user.email,
    dryRun,
    activities: activities.length,
    summariesUpdated,
    qualityOnly,
    empty,
  }, null, 2));
} catch (error) {
  console.error("Summary recompute failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
