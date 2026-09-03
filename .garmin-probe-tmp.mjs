#!/usr/bin/env node
// Read-only probe: fetches one real activity detail payload and inspects
// what the Garmin API returns for distance/grade. Does NOT touch the DB.
import { createCipheriv, createDecipheriv, createHash } from "crypto";
import { createFromSession } from "garmin-connect-client";
import postgres from "postgres";

try { process.loadEnvFile("/mnt/www/map/endurolabs/.env"); } catch {}
const secret = process.env.GARMIN_TOKEN_ENCRYPTION_KEY;
if (!secret || secret.length < 32) { console.error("no GARMIN_TOKEN_ENCRYPTION_KEY"); process.exit(1); }

const url = process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, max:1 });
const decrypt = (s) => {
  const [iv, tag, ct] = s.split(".");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(iv,"base64url"));
  d.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct,"base64url")), d.final()]).toString("utf8"));
};

try {
  const [conn] = await sql`
    select g.encrypted_tokens as t,
           r.provider_activity_id as pid,
           r.start_time_gmt as st,
           r.activity_name,
           r.distance_meters as summary_distance
    from garmin_connections g
    join users u on u.id = g.user_id
    join run_activities r on r.user_id = u.id
    where g.status='connected' and r.activity_name like '%Running%'
    order by r.duration_seconds desc limit 1
  `;
  console.log("target activity:", conn.activity_name, "summary_distance=", conn.summary_distance, "m");
  const auth = decrypt(conn.t);
  if (auth.kind !== "session") { console.error("connection requires MFA"); process.exit(1); }
  const client = createFromSession(auth.session);
  const path = `activity-service/activity/${encodeURIComponent(conn.pid)}/details?maxChartSize=2000&maxPolylineSize=2000`;
  let payload;
  try { payload = await client.httpClient.get(`https://connectapi.garmin.com/${path}`); }
  catch(e1){ try { payload = await client.httpClient.get(`https://connect.garmin.com/modern/proxy/${path}`); } catch(e2){ console.error("fetch failed", e1.message, e2.message); process.exit(1); }}

  console.log("\n=== metricDescriptors ===");
  for (const d of payload.metricDescriptors ?? []) {
    console.log(d.metricsIndex, d.key);
  }
  const idx = new Map((payload.metricDescriptors ?? []).map((d,i)=>[String(d.key).toLowerCase().replace(/[^a-z0-9]/g,''), d.metricsIndex ?? i]));
  const rows = payload.activityDetailMetrics ?? [];
  console.log("\n=== first 3 rows (raw metric arrays) ===");
  const keysOfInterest = ["distance","elevation","grade","directdistance","speed","heartrate","directgrade"];
  for (const r of rows.slice(0,3)) {
    const m = Array.isArray(r.metrics) ? r.metrics : r;
    console.log(m);
  }
  // compute per-metric null ratio for the keys we care about
  const nullCheck = (name) => {
    const i = idx.get(name);
    if (i === undefined) return `key '${name}' not in descriptors`;
    let nulls = 0;
    for (const r of rows) {
      const m = Array.isArray(r?.metrics) ? r.metrics : Array.isArray(r) ? r : null;
      const v = m ? m[i] : null;
      if (v === null || v === undefined) nulls++;
    }
    return `${name}: idx=${i} nulls=${nulls}/${rows.length} (${(100*nulls/Math.max(rows.length,1)).toFixed(0)}%)`;
  };
  for (const k of keysOfInterest) console.log(nullCheck(k));
} finally {
  await sql.end();
}
