#!/usr/bin/env node

// Imports Garmin run summaries back to a requested date. This bypasses the
// package's strict parser because some valid older records omit activityName.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { createFromSession } from "garmin-connect-client";
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function decrypt(encrypted) {
  const secret = process.env.GARMIN_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("GARMIN_TOKEN_ENCRYPTION_KEY must contain at least 32 characters");
  const [iv, tag, ciphertext] = encrypted.split(".");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8"));
}

function encrypt(value) {
  const secret = process.env.GARMIN_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("GARMIN_TOKEN_ENCRYPTION_KEY must contain at least 32 characters");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

const since = argument("since");
if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("Usage: npm run garmin:history -- --since YYYY-MM-DD [--email runner@example.com]");
  process.exit(1);
}

const email = argument("email");
const sql = postgres(process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab", { prepare: false });

let connection;
let client;
const workerToken = randomUUID();
try {
  [connection] = await sql`
    select g.id, g.encrypted_tokens as "encryptedTokens", u.id as "userId", u.email
    from garmin_connections g join users u on u.id = g.user_id
    where g.status = 'connected' ${email ? sql`and u.email = ${email}` : sql``}
    order by u.created_at limit 1
  `;
  if (!connection) throw new Error(email ? `No connected Garmin account for ${email}` : "No connected Garmin account found");
  const [leased] = await sql`update garmin_connections set active_worker_token = ${workerToken},
    active_job_lease_expires_at = now() + interval '5 minutes', updated_at = now()
    where id = ${connection.id} and (active_worker_token is null or active_job_lease_expires_at <= now())
    returning encrypted_tokens as "encryptedTokens"`;
  if (!leased) throw new Error("Another Garmin import is already running");
  connection.encryptedTokens = leased.encryptedTokens;
  const auth = decrypt(connection.encryptedTokens);
  if (auth.kind !== "session") throw new Error("Garmin connection still requires MFA");
  client = createFromSession(auth.session);
  const fetched = [];
  for (let start = 0; start < 5000; start += 200) {
    await sql`update garmin_connections set active_job_lease_expires_at = now() + interval '5 minutes', updated_at = now()
      where id = ${connection.id} and active_worker_token = ${workerToken}`;
    const page = await client.httpClient.get(`https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=${start}&limit=200`);
    fetched.push(...page);
    const oldest = page.at(-1)?.startTimeLocal?.slice(0, 10);
    if (page.length < 200 || (oldest && oldest < since)) break;
  }

  const runs = fetched.filter((activity) => {
    const type = String(activity.activityType?.typeKey ?? "").toLowerCase();
    return activity.startTimeLocal?.slice(0, 10) >= since && (type.includes("running") || type.includes("run"));
  });
  let imported = 0;
  for (const activity of runs) {
    const startTimeGmt = new Date(`${activity.startTimeGMT}${String(activity.startTimeGMT).endsWith("Z") ? "" : "Z"}`);
    if (!activity.activityId || Number.isNaN(startTimeGmt.getTime())) continue;
    const now = new Date();
    await sql`insert into run_activities (
      user_id, provider_activity_id, source, power_source, activity_name, activity_type, event_type,
      local_date, start_time_local, start_time_gmt, distance_meters, duration_seconds,
      moving_duration_seconds, elevation_gain_meters, average_heart_rate, max_heart_rate,
      average_cadence, average_power, calories, device_name, synced_at, updated_at
    ) values (
      ${connection.userId}, ${String(activity.activityId)}, 'garmin', ${String(activity.manufacturer ?? "").toLowerCase().includes("apple") ? "apple_watch" : "garmin"},
      ${activity.activityName?.trim() || "Garmin run"}, ${activity.activityType?.typeKey || "running"}, ${activity.eventType?.typeKey || null},
      ${activity.startTimeLocal.slice(0, 10)}, ${activity.startTimeLocal}, ${startTimeGmt},
      ${Math.max(0, rounded(activity.distance) ?? 0)}, ${Math.max(0, rounded(activity.duration) ?? 0)},
      ${rounded(activity.movingDuration)}, ${rounded(activity.elevationGain)}, ${rounded(activity.averageHR)},
      ${rounded(activity.maxHR)}, ${rounded(activity.averageRunningCadenceInStepsPerMinute)},
      ${rounded(activity.avgPower)}, ${rounded(activity.calories)}, ${activity.manufacturer?.trim() || null},
      ${now}, ${now}
    ) on conflict (user_id, source, provider_activity_id) do update set
      power_source = excluded.power_source,
      activity_name = excluded.activity_name, activity_type = excluded.activity_type,
      event_type = coalesce(excluded.event_type, run_activities.event_type),
      local_date = excluded.local_date, start_time_local = excluded.start_time_local,
      start_time_gmt = excluded.start_time_gmt, distance_meters = excluded.distance_meters,
      duration_seconds = excluded.duration_seconds, moving_duration_seconds = excluded.moving_duration_seconds,
      elevation_gain_meters = excluded.elevation_gain_meters, average_heart_rate = excluded.average_heart_rate,
      max_heart_rate = excluded.max_heart_rate, average_cadence = excluded.average_cadence,
      average_power = excluded.average_power, calories = excluded.calories,
      device_name = excluded.device_name, synced_at = excluded.synced_at, updated_at = excluded.updated_at`;
    imported += 1;
  }

  // Auto-fill summary power for any race that still has none, using the
  // athlete's measured speed→power model. Guarded by average_power IS NULL
  // so measured summaries and prior estimates are never overwritten.
  let estimatedRaces = 0;
  const measured = await sql`
    select distance_meters as dist, duration_seconds as dur, moving_duration_seconds as mov, average_power as p
    from run_activities
    where user_id = ${connection.userId} and source = 'garmin'
      and average_power is not null and power_source not like 'estimated_%' and duration_seconds > 0
  `;
  const points = measured
    .map((row) => ({ speed: row.dist / ((row.mov ?? row.dur) || 1), power: row.p }))
    .filter((row) => Number.isFinite(row.speed) && row.speed > 0);
  if (points.length >= 5) {
    const meanX = points.reduce((a, b) => a + b.speed, 0) / points.length;
    const meanY = points.reduce((a, b) => a + b.power, 0) / points.length;
    const variance = points.reduce((a, b) => a + (b.speed - meanX) ** 2, 0);
    if (variance > 0) {
      const slope = points.reduce((a, b) => a + (b.speed - meanX) * (b.power - meanY), 0) / variance;
      const intercept = meanY - slope * meanX;
      const [applied] = await sql`
        update run_activities
        set average_power = round((${intercept} + ${slope} * (distance_meters::double precision
          / greatest(coalesce(moving_duration_seconds, duration_seconds), 1))))::int,
            power_source = 'estimated_speed_v1', updated_at = now()
        where user_id = ${connection.userId} and source = 'garmin' and event_type = 'race'
          and average_power is null and duration_seconds > 0
        returning id
      `;
      estimatedRaces = applied.length;
    }
  }
  console.log(JSON.stringify({ user: connection.email, since, fetched: fetched.length, runs: runs.length, imported, estimatedRaces }, null, 2));
} catch (error) {
  console.error("Garmin history sync failed:", error.message);
  process.exitCode = 1;
} finally {
  if (connection && client) {
    await sql`update garmin_connections set encrypted_tokens = ${encrypt({ kind: "session", session: client.getSession() })},
      active_job_id = null, active_worker_token = null, active_job_lease_expires_at = null, updated_at = now()
      where id = ${connection.id} and active_worker_token = ${workerToken}`;
  } else if (connection) {
    await sql`update garmin_connections set active_job_id = null, active_worker_token = null,
      active_job_lease_expires_at = null, updated_at = now()
      where id = ${connection.id} and active_worker_token = ${workerToken}`;
  }
  await sql.end();
}
