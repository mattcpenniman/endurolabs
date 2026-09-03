import { createDecipheriv, createHash } from "crypto";
import { createFromSession } from "garmin-connect-client";
import postgres from "postgres";
try { process.loadEnvFile("/mnt/www/map/endurolabs/.env"); } catch {}
const secret = process.env.GARMIN_TOKEN_ENCRYPTION_KEY;
const url = process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, max:1 });
const decrypt = (s) => {
  const [iv, tag, ct] = s.split(".");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), Buffer.from(iv,"base64url"));
  d.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct,"base64url")), d.final()]).toString("utf8"));
};
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
console.log("target activity:", conn.activity_name, "summary_dist=", conn.summary_distance, "m");
const auth = decrypt(conn.t);
if (auth.kind !== "session") { console.error("connection requires MFA"); await sql.end(); process.exit(1); }
const client = createFromSession(auth.session);
console.log("garmin client connected");
const path = `activity-service/activity/${encodeURIComponent(conn.pid)}/details?maxChartSize=100&maxPolylineSize=100`;
console.log("fetching:", "https://connectapi.garmin.com/" + path);
const t0 = Date.now();
try {
  const payload = await client.httpClient.get(`https://connectapi.garmin.com/${path}`);
  console.log(`elapsed_ms=${Date.now()-t0}`);
  console.log("\n=== metricDescriptors ===");
  for (const d of payload.metricDescriptors ?? []) console.log(d.metricsIndex, d.key);
  const mrows = payload.activityDetailMetrics ?? [];
  console.log("\n=== first 3 rows of activityDetailMetrics ===");
  for (const r of mrows.slice(0,3)) console.log(JSON.stringify(r.metrics ?? r));
} catch (e) {
  console.error("fetch failed:", e?.message ?? e);
  console.log("(trying proxy fallback…)");
  const path2 = `https://connect.garmin.com/modern/proxy/activity-service/activity/${encodeURIComponent(conn.pid)}/details?maxChartSize=100`;
  const payload = await client.httpClient.get(path2);
  for (const d of payload.metricDescriptors ?? []) console.log(d.metricsIndex, d.key);
  const mrows = payload.activityDetailMetrics ?? [];
  for (const r of mrows.slice(0,3)) console.log(JSON.stringify(r.metrics ?? r));
}
await sql.end();
