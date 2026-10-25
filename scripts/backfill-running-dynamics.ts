#!/usr/bin/env node
/** Explicitly scoped, inventory-first historical dynamics detail refetch. No production execution implied. */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { decryptGarminTokens, encryptGarminTokens } from "../src/lib/garmin/crypto";
import { openGarminSession, garminCredentialsFor, GarminMfaRequiredError } from "../src/lib/garmin/client";
import type { StoredGarminAuth } from "../src/lib/garmin/client";
import { backfillErrorCode, DYNAMICS_BACKFILL_VERSION, parseBackfillOptions, retryDelay, validateDynamicsDetail } from "../src/lib/garmin/dynamics-backfill";
import { dynamicsCoverage, persistDynamicsDetail } from "../src/lib/garmin/dynamics-backfill-store";

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(`Usage: npm run dynamics:backfill -- (--email EMAIL | --user-id UUID)
  [--since YYYY-MM-DD] [--through YYYY-MM-DD] [--limit 1-1000] [--apply] [--retry-failed]
Default: DB-only read-only inventory, no provider/auth calls or writes.
Apply: sequential detail GETs, at most 3 attempts/activity/invocation; 100 activities by default.
Dates inclusive UTC. Resume with the same scope; terminal versioned attempts are skipped.
SIGINT/SIGTERM finishes the current atomic activity then stops. See docs/running-dynamics-backfill.md.`);
    return;
  }
  const options = parseBackfillOptions(process.argv.slice(2));
  try { process.loadEnvFile(".env"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, max_lifetime: 0, connect_timeout: 10 });
  const token = `dynamics:${randomUUID()}`;
  let connectionId: string | undefined;
  let ciphertext: string | undefined;
  let lockedUser: string | undefined;
  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const counts = { eligible: 0, selected: 0, attempted: 0, requests: 0, succeeded: 0, unavailable: 0, failed: 0, exhausted: 0 };
  try {
    // Enforce preview at the DB layer as well as at control-flow boundaries.
    if (!options.apply) await sql`set default_transaction_read_only = on`;
    const [user] = await sql`select id from users where ${options.email ? sql`email=${options.email}` : sql`id=${options.userId!}`}`;
    if (!user) throw new Error("Athlete not found");
    const [table] = await sql`select to_regclass('garmin_dynamics_backfill') as name`;
    if (options.apply && !table.name) throw new Error("Apply requires scripts/add-dynamics-backfill.sql during authorized rollout");
    const checkpoint = table.name ? sql`left join garmin_dynamics_backfill c on c.activity_id=a.id and c.version=${DYNAMICS_BACKFILL_VERSION}`
      : sql`left join (select null::uuid as activity_id, null::text as status, null::integer as attempts, null::integer as sample_count, null::timestamptz as next_retry_at) c on false`;
    const activities = await sql`select a.id, a.provider_activity_id, a.start_time_gmt,
      c.status, coalesce(c.attempts,0)::int as attempts, count(s.id)::int as stored_count,
      c.sample_count as checkpoint_count, c.next_retry_at
      from run_activities a ${checkpoint} left join activity_samples s on s.activity_id=a.id
      where a.user_id=${user.id} and a.source='garmin'
      ${options.since ? sql`and a.start_time_gmt >= (${options.since}::date::timestamp at time zone 'UTC')` : sql``}
      ${options.through ? sql`and a.start_time_gmt < ((${options.through}::date + 1)::timestamp at time zone 'UTC')` : sql``}
      group by a.id, c.status, c.attempts, c.sample_count, c.next_retry_at order by a.start_time_gmt, a.id`;
    const eligible = activities.filter((row) => !["succeeded", "unavailable"].includes(row.status) || row.stored_count !== row.checkpoint_count);
    counts.eligible = eligible.length;
    counts.exhausted = eligible.filter((row) => row.attempts >= 3).length;
    const selected = eligible.filter((row) => (options.retryFailed || row.attempts < 3)
      && (!row.next_retry_at || new Date(row.next_retry_at).getTime() <= Date.now())).slice(0, options.limit);
    counts.selected = selected.length;
    const ids = selected.map((row) => row.id as string);
    const before = ids.length ? await dynamicsCoverage(sql, ids) : null;
    console.log(JSON.stringify({ mode: options.apply ? "apply" : "db-only-inventory", version: DYNAMICS_BACKFILL_VERSION,
      scoped: activities.length, ...counts, before, maximumDetailRequests: options.apply ? selected.length * 3 : 0 }));
    if (!options.apply || !selected.length) return;
    const [lock] = await sql`select pg_try_advisory_lock(hashtext(${`garmin-export:${user.id}`})) as ok`;
    if (!lock.ok) throw new Error("Another Garmin operation is active");
    lockedUser = user.id;
    // The session advisory lock excludes a live prior backfill. Only our own expired
    // lease is recoverable; app/job/legacy worker tokens are never taken over here.
    const [connection] = await sql`update garmin_connections set active_worker_token=${token},
      active_job_lease_expires_at=now()+interval '10 minutes', updated_at=now()
      where user_id=${user.id} and (active_worker_token is null or
        (active_worker_token like 'dynamics:%' and active_job_lease_expires_at <= now())) and active_job_id is null
      and (status='connected' or (status='error' and remember_me))
      returning id, encrypted_tokens, garmin_username, remember_me, encrypted_password`;
    if (!connection) throw new Error("Garmin worker owns connection or reconnect/MFA required; no ownership changed");
    connectionId = connection.id; ciphertext = connection.encrypted_tokens;
    const saveAuth = async (auth: StoredGarminAuth, status = "connected"): Promise<void> => {
      const next = encryptGarminTokens(auth);
      const [saved] = await sql`update garmin_connections set encrypted_tokens=${next}, status=${status}, updated_at=now()
        where id=${connectionId!} and active_worker_token=${token} and encrypted_tokens=${ciphertext!}
        and active_job_lease_expires_at > now() returning id`;
      if (!saved) throw new Error("ownership_lost");
      ciphertext = next;
    };
    let opened;
    try {
      opened = await openGarminSession(decryptGarminTokens<StoredGarminAuth>(ciphertext!), garminCredentialsFor({
        garminUsername: connection.garmin_username, rememberMe: connection.remember_me, encryptedPassword: connection.encrypted_password,
      }));
      await saveAuth(opened.auth);
    } catch (error) {
      if (error instanceof GarminMfaRequiredError) await saveAuth(error.pending, "mfa_required");
      throw error;
    }
    const transport = opened.client as unknown as { httpClient: {
      get(url: string): Promise<unknown>;
      client: { defaults: { timeout: number }; interceptors: { response: { clear(): void } } };
    } };
    transport.httpClient.client.defaults.timeout = 30_000;
    // Auth refresh is done explicitly above. Prevent hidden replay/unbounded 401 recursion.
    transport.httpClient.client.interceptors.response.clear();
    for (const activity of selected) {
      if (abort.signal.aborted) break;
      counts.attempted++;
      let success = false;
      const budget = options.retryFailed ? 3 : Math.min(3, 3 - activity.attempts);
      for (let attempt = 1; attempt <= budget; attempt++) {
        if (abort.signal.aborted) break;
        const [renewed] = await sql`update garmin_connections set active_job_lease_expires_at=now()+interval '10 minutes'
          where id=${connectionId!} and active_worker_token=${token} and encrypted_tokens=${ciphertext!}
          and active_job_lease_expires_at > now() returning id`;
        if (!renewed) throw new Error("ownership_lost");
        await sql`insert into garmin_dynamics_backfill (activity_id,version,status,attempts)
          values (${activity.id},${DYNAMICS_BACKFILL_VERSION},'running',1)
          on conflict(activity_id,version) do update set status='running', attempts=garmin_dynamics_backfill.attempts+1, updated_at=now()`;
        counts.requests++;
        try {
          const payload = await transport.httpClient.get(`https://connectapi.garmin.com/activity-service/activity/${encodeURIComponent(activity.provider_activity_id)}/details?maxChartSize=20000&maxPolylineSize=10`);
          const samples = validateDynamicsDetail(payload, new Date(activity.start_time_gmt));
          const result = await persistDynamicsDetail(sql, activity.id, connectionId!, token, samples);
          counts[result]++; success = true;
          break;
        } catch (error) {
          const code = backfillErrorCode(error);
          if (code === "ownership_lost") throw error;
          const retryAfter = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers?.["retry-after"];
          const seconds = Number(retryAfter);
          const requested = retryAfter === undefined ? 0 : Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(String(retryAfter));
          const nextRetry = new Date(Math.max(Date.now() + 15 * 60_000, Number.isFinite(requested) ? requested : 0));
          await sql`update garmin_dynamics_backfill set status='failed', error_code=${code}, next_retry_at=${nextRetry}, updated_at=now()
            where activity_id=${activity.id} and version=${DYNAMICS_BACKFILL_VERSION}`;
          if (code === "auth_required" || code === "mfa_required") { abort.abort(); break; }
          const delay = retryDelay(error, attempt);
          if (delay === null || attempt === budget) break;
          try { await sleep(delay, undefined, { signal: abort.signal }); } catch { break; }
        }
      }
      if (!success) counts.failed++;
      console.log(JSON.stringify({ ...counts }));
    }
    console.log(JSON.stringify({ mode: "apply-result", ...counts, before, after: await dynamicsCoverage(sql, ids), cancelled: abort.signal.aborted }));
    if (counts.failed || abort.signal.aborted) process.exitCode = 1;
  } finally {
    try {
      if (connectionId) await sql`update garmin_connections set active_worker_token=null, active_job_lease_expires_at=null,
        updated_at=now() where id=${connectionId} and active_worker_token=${token}`;
      if (lockedUser) await sql`select pg_advisory_unlock(hashtext(${`garmin-export:${lockedUser}`}))`;
    } finally {
      // Closing the dedicated session releases the advisory lock even if cleanup SQL failed.
      process.off("SIGINT", stop); process.off("SIGTERM", stop);
      await sql.end({ timeout: 5 });
    }
  }
}
export const execution = main().catch((error: unknown) => {
  // Never print provider error/config/payloads; even transport errors may include credentials.
  const known = error instanceof Error && !('response' in error) && !('isAxiosError' in error);
  console.error(JSON.stringify({ error: known && /^(Provide|Invalid|Limit|Date|Option|Athlete|DATABASE_URL|Apply requires|Another Garmin|Garmin worker)/.test(error.message)
    ? error.message : backfillErrorCode(error) }));
  process.exitCode = 1;
});
