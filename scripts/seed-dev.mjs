#!/usr/bin/env node

// ============================================================
// EnduroLab — Dev Seed: realistic HR/Power sample traces
// ============================================================
// Generates synthetic, internally-consistent Garmin running
// power + heart-rate traces (activity_samples) for the running
// activities belonging to the current user, plus a body-weight
// measurement. This lets the Power @ 140 bpm analytics run on
// locally-synthesized data without a live Garmin session.
//
// Usage:
//   npm run seed:dev  # uses first user + their activities
// ============================================================

import postgres from "postgres";

const METERS_PER_MILE = 1609.344;
const SEED = 20260901;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const jitter = (mag) => (rand() - 0.5) * 2 * mag;

// Physiological relationship: higher HR => higher power.
// We model steady-aerobic running so the regression recovers a
// clean slope. power ~= a + b*hr with realistic spread.
const POWER_SLOPE = 3.4;   // W per bpm
const POWER_INTERCEPT = -180; // W

function sampleTrace(durationSeconds, activityId, baseHr, basePaceMinPerMile) {
  const step = Math.max(1, Math.floor(durationSeconds / 400)); // ~400 samples per run
  const out = [];
  let dist = 0;
  const mps = 1609.344 / (basePaceMinPerMile * 60);
  for (let t = 0; t < durationSeconds; t += step) {
    const ramp = 1 - Math.exp(-t / 420);
    const hr = baseHr + (150 - baseHr) * ramp + jitter(2.5);
    // Cardiac drift: HR creeps up late in the run.
    const drift = t / durationSeconds * 4;
    const hrFinal = hr + drift + jitter(1.5);
    const hrClamped = Math.round(Math.min(185, Math.max(85, hrFinal)));

    const expectedHr = hrClamped - 0;
    const power = POWER_INTERCEPT + POWER_SLOPE * expectedHr + jitter(9);
    const powerClamped = Math.max(90, Math.round(power));

    const cadence = Math.round(165 + (hrFinal - 140) * 0.25 + jitter(6));
    const elevation = 80 + 20 * Math.sin(t / 600) + jitter(3);
    const grade = jitter(0.02);
    const speed = mps * (1 + 0.02 * Math.sin(t / 900) + jitter(0.01));

    out.push({
      activityId,
      timestamp: 0, // set on insert
      elapsedSeconds: t,
      distanceMeters: (dist += step * speed),
      heartRate: hrClamped,
      power: powerClamped,
      speedMetersPerSecond: Number(speed.toFixed(3)),
      elevationMeters: Number(elevation.toFixed(1)),
      grade: Number(grade.toFixed(4)),
      cadence,
      latitude: null,
      longitude: null,
      temperatureCelsius: Number((12 + jitter(4)).toFixed(1)),
    });
  }
  return out;
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  const [user] = await sql`select id, email from users order by created_at limit 1`;
  if (!user) {
    console.error("No user found. Create one first: npm run user:create");
    process.exit(1);
  }

  const activities = await sql`
    select id, distance_meters as "distanceMeters", duration_seconds as "durationSeconds",
           local_date as "localDate", average_heart_rate as "averageHeartRate"
    from run_activities
    where user_id = ${user.id}
    order by start_time_gmt asc
  `;
  if (activities.length === 0) {
    console.error("No activities found for", user.email, "— sync Garmin or seed activities first.");
    process.exit(1);
  }

  const SAMPLE_COLUMNS = [
    "timestamp","elapsed_seconds","distance_meters","heart_rate","power",
    "speed_meters_per_second","elevation_meters","grade","cadence",
    "latitude","longitude","temperature_celsius","activity_id",
  ].map((c) => `"${c}"`).join(",");
  const now = new Date().toISOString();

  let sampleCount = 0;
  for (const a of activities) {
    const pace = a.distanceMeters > 0
      ? (a.durationSeconds / 60) / (a.distanceMeters / METERS_PER_MILE)
      : 9;
    const baseHr = a.averageHeartRate ?? 142;
    const trace = sampleTrace(a.durationSeconds, a.id, baseHr, pace);
    if (trace.length === 0) continue;

    await sql`delete from activity_samples where activity_id = ${a.id}`;
    const idLit = `'${String(a.id).replace(/'/g, "''")}'::uuid`;
    const ts = `'${now}'`;
    const values = trace.map((s) => `(${ts},${s.elapsedSeconds},${s.distanceMeters},${s.heartRate},${s.power},${s.speedMetersPerSecond},${s.elevationMeters},${s.grade},${s.cadence},NULL,NULL,${s.temperatureCelsius},${idLit})`).join(",");
    await sql.unsafe(`insert into activity_samples (${SAMPLE_COLUMNS}) values ${values}`);
    sampleCount += trace.length;
  }

  // One body-weight measurement so W/kg can be computed (idempotent).
  const existingWeight = await sql`
    select weight_kg from weight_measurements where user_id = ${user.id} limit 1
  `;
  let bodyWeight = existingWeight[0]?.weightKg ?? existingWeight[0]?.weight_kg ?? null;
  if (bodyWeight === null) {
    await sql`
      insert into weight_measurements (user_id, measured_at, weight_kg, source)
      values (${user.id}, now(), 74.5, 'scale')
    `;
    bodyWeight = 74.5;
  }

  console.log(JSON.stringify({
    user: user.email,
    activities: activities.length,
    samples: sampleCount,
    bodyWeightKg: bodyWeight,
  }, null, 2));
} catch (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
} finally {
  await sql.end();
}
