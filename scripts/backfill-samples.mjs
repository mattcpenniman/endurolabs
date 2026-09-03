#!/usr/bin/env node

// Backfills Garmin activity detail into activity_samples. Safe to resume or rerun:
// samples are upserted by (activity_id, elapsed_seconds).

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { createFromSession } from "garmin-connect-client";
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const concurrency = Math.min(Math.max(Number(argument("concurrency") ?? 2), 1), 4);
const email = argument("email");
const days = argument("days") ? Math.max(Number(argument("days")), 1) : null;
const onlyMissing = process.argv.includes("--only-missing");
const sql = postgres(databaseUrl, { prepare: false });

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

function number(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed);
}

function mapDetail(payload, startTime) {
  const descriptors = Array.isArray(payload?.metricDescriptors) ? payload.metricDescriptors : [];
  const indexes = new Map(descriptors.map((descriptor, index) => [String(descriptor.key).replace(/[^a-z0-9]/gi, "").toLowerCase(), descriptor.metricsIndex ?? index]));
  const rows = Array.isArray(payload?.activityDetailMetrics) ? payload.activityDetailMetrics : [];
  const aliases = {
    timestamp: ["directtimestamp", "timestamp"], elapsed: ["directelapsedtime", "elapsedtime"],
    distance: ["directdistance", "distance"], heartRate: ["directheartrate", "heartrate"],
    power: ["directpower", "power", "enhancedpower"], speed: ["directspeed", "speed", "enhancedspeed"],
    elevation: ["directelevation", "elevation", "enhancedelevation"], grade: ["directgrade", "grade"],
    cadence: ["directruncadence", "runcadence", "directcadence", "cadence"], latitude: ["directlatitude", "latitude", "positionlat"],
    longitude: ["directlongitude", "longitude", "positionlong"], temperature: ["directtemperature", "temperature"],
  };
  const value = (row, names) => {
    const metrics = Array.isArray(row?.metrics) ? row.metrics : Array.isArray(row) ? row : null;
    for (const name of names) {
      const index = indexes.get(name);
      if (metrics && index !== undefined && metrics[index] !== undefined) return metrics[index];
      const key = Object.keys(row ?? {}).find((candidate) => candidate.replace(/[^a-z0-9]/gi, "").toLowerCase() === name);
      if (key) return row[key];
    }
    return null;
  };
  const mapped = rows.flatMap((row) => {
    const elapsedValue = number(value(row, aliases.elapsed));
    const timestampValue = value(row, aliases.timestamp);
    const numericTimestamp = number(timestampValue);
    let timestamp = timestampValue === null
      ? null
      : new Date(numericTimestamp === null ? timestampValue : numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp);
    if (!timestamp || Number.isNaN(timestamp.getTime())) timestamp = elapsedValue === null ? null : new Date(startTime.getTime() + elapsedValue * 1000);
    const elapsed = elapsedValue ?? (timestamp ? (timestamp.getTime() - startTime.getTime()) / 1000 : null);
    if (!timestamp || elapsed === null || elapsed < 0) return [];
    const coordinate = (raw) => {
      const parsed = number(raw);
      return parsed !== null && Math.abs(parsed) > 180 ? parsed * (180 / 2 ** 31) : parsed;
    };
    return [{
      timestamp, elapsed_seconds: Math.round(elapsed), distance_meters: number(value(row, aliases.distance)),
      heart_rate: integer(value(row, aliases.heartRate)), power: integer(value(row, aliases.power)),
      speed_meters_per_second: number(value(row, aliases.speed)), elevation_meters: number(value(row, aliases.elevation)),
      grade: number(value(row, aliases.grade)), cadence: integer(value(row, aliases.cadence)),
      latitude: coordinate(value(row, aliases.latitude)), longitude: coordinate(value(row, aliases.longitude)),
      temperature_celsius: number(value(row, aliases.temperature)),
    }];
  });
  return [...new Map(mapped.map((sample) => [sample.elapsed_seconds, sample])).values()].sort((a, b) => a.elapsed_seconds - b.elapsed_seconds);
}

async function runPool(values, mapper) {
  let index = 0;
  async function worker() {
    while (index < values.length) await mapper(values[index++]);
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
}

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
  const activities = await sql`
    select id, provider_activity_id as "providerActivityId", start_time_gmt as "startTimeGmt"
    from run_activities
    where user_id = ${connection.userId} and source = 'garmin'
      ${days ? sql`and start_time_gmt >= now() - (${days} * interval '1 day')` : sql``}
      ${onlyMissing ? sql`and samples_fetched_at is null` : sql``}
    order by start_time_gmt
  `;
  let completed = 0;
  let failed = 0;
  await runPool(activities, async (activity) => {
    try {
      await sql`update garmin_connections set active_job_lease_expires_at = now() + interval '5 minutes', updated_at = now()
        where id = ${connection.id} and active_worker_token = ${workerToken}`;
      const path = `activity-service/activity/${encodeURIComponent(activity.providerActivityId)}/details?maxChartSize=20000&maxPolylineSize=20000`;
      let payload;
      try {
        payload = await client.httpClient.get(`https://connectapi.garmin.com/${path}`);
      } catch (error) {
        try { payload = await client.httpClient.get(`https://connect.garmin.com/modern/proxy/${path}`); } catch { throw error; }
      }
      const samples = mapDetail(payload, activity.startTimeGmt);
      for (let start = 0; start < samples.length; start += 500) {
        const values = samples.slice(start, start + 500).map((sample) => ({ ...sample, activity_id: activity.id }));
        await sql`insert into activity_samples ${sql(values)} on conflict (activity_id, elapsed_seconds) do update set
          timestamp = excluded.timestamp, distance_meters = excluded.distance_meters, heart_rate = excluded.heart_rate,
          power = excluded.power, speed_meters_per_second = excluded.speed_meters_per_second,
          elevation_meters = excluded.elevation_meters, grade = excluded.grade, cadence = excluded.cadence,
          latitude = excluded.latitude, longitude = excluded.longitude, temperature_celsius = excluded.temperature_celsius`;
      }
      await sql`delete from activity_samples
        where activity_id = ${activity.id}
          and abs(extract(epoch from (timestamp - ${activity.startTimeGmt})) - elapsed_seconds) > 2`;
      const [{ count }] = await sql`select count(*)::int as count from activity_samples where activity_id = ${activity.id}`;
      await sql`update run_activities set sample_count = ${count}, samples_fetched_at = now(),
        detail_fetch_status = ${count > 0 ? "success" : "empty"}, detail_attempt_count = detail_attempt_count + 1,
        detail_last_attempt_at = now(), detail_last_error = null, detail_next_retry_at = null, updated_at = now()
        where id = ${activity.id}`;
      completed += 1;
      console.log(`[${completed + failed}/${activities.length}] ${activity.providerActivityId}: ${count} samples`);
    } catch (error) {
      await sql`update run_activities set detail_fetch_status = 'failed', detail_attempt_count = detail_attempt_count + 1,
        detail_last_attempt_at = now(), detail_last_error = ${String(error.message).slice(0, 1000)},
        detail_next_retry_at = now() + interval '15 minutes', updated_at = now() where id = ${activity.id}`;
      failed += 1;
      console.error(`[${completed + failed}/${activities.length}] ${activity.providerActivityId}: ${error.message}`);
    }
  });
  console.log(JSON.stringify({ user: connection.email, activities: activities.length, completed, failed }, null, 2));
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error("Backfill failed:", error.message);
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
