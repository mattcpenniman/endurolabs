// @vitest-environment node
/** Real PostgreSQL, synthetic provider responses: no live Garmin calls. */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptGarminTokens, decryptGarminTokens } from "../lib/garmin/crypto";
import { GarminMfaRequiredError } from "../lib/garmin/client";

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), delay: vi.fn(async () => {}) }));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }));
vi.mock("../lib/garmin/client", async (original) => ({ ...await original<object>(), openGarminSession: mocks.open }));
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const start = new Date("2026-01-01T00:00:00Z");
const payload = { totalMetricsCount: 2, metricDescriptors: [
  { key: "directElapsedTime", metricsIndex: 0 },
  { key: "directVerticalOscillation", metricsIndex: 1, unit: { key: "centimeter", factor: 1 } },
  { key: "directStrideLength", metricsIndex: 2, unit: { key: "centimeter", factor: 1 } },
], activityDetailMetrics: [{ metrics: [0, 6.44, 109.14] }, { metrics: [1, 6.45, null] }] };

suite("resumable dynamics backfill PostgreSQL/CLI", () => {
  let sql: ReturnType<typeof postgres>;
  let schema: string;
  let user: string, activity: string, connection: string;
  let argv: string[];
  let output: ReturnType<typeof vi.spyOn>;
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.resetModules(); mocks.get.mockReset(); mocks.open.mockReset(); mocks.delay.mockClear();
    vi.stubEnv("GARMIN_TOKEN_ENCRYPTION_KEY", "synthetic-test-key-only-not-production-123456789");
    schema = `backfill_${crypto.randomUUID().replaceAll("-", "")}`;
    sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    await sql`create schema ${sql(schema)}`;
    await sql`set search_path to ${sql(schema)}`;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    vi.stubEnv("DATABASE_URL", url.toString());
    await sql`create table users(id uuid primary key, email text)`;
    await sql`create table garmin_connections(id uuid primary key, user_id uuid, encrypted_tokens text,
      status text, garmin_username text, remember_me boolean default false, encrypted_password text,
      active_worker_token text, active_job_id uuid, active_job_lease_expires_at timestamptz, updated_at timestamptz)`;
    await sql`create table run_activities(id uuid primary key, user_id uuid, source text, provider_activity_id text,
      start_time_gmt timestamptz, samples_fetched_at timestamptz, sample_count integer,
      effort_override text, excluded_from_analytics boolean, plan_id uuid, workout_id text,
      distance_meters integer, average_power integer, vertical_oscillation_cm double precision)`;
    await sql`create table activity_samples(id uuid primary key default gen_random_uuid(), activity_id uuid,
      elapsed_seconds integer, timestamp timestamptz, heart_rate integer, power integer,
      vertical_oscillation_cm double precision, vertical_ratio_percent double precision, ground_contact_time_ms double precision,
      ground_contact_balance_left_percent double precision, stride_length_cm double precision, unique(activity_id,elapsed_seconds))`;
    await sql.unsafe(await readFile(new URL("../../scripts/add-dynamics-backfill.sql", import.meta.url), "utf8"));
    user = crypto.randomUUID(); activity = crypto.randomUUID(); connection = crypto.randomUUID();
    await sql`insert into users values(${user},'runner@example.test')`;
    await sql`insert into garmin_connections(id,user_id,encrypted_tokens,status,garmin_username) values
      (${connection},${user},${encryptGarminTokens({kind:"session",session:{old:true}})},'connected','runner')`;
    await sql`insert into run_activities values (${activity},${user},'garmin','123',${start},${start},2,
      'threshold',true,${crypto.randomUUID()},'saved-workout',5000,301,6.4)`;
    await sql`insert into activity_samples(activity_id,elapsed_seconds,timestamp,heart_rate,power) values
      (${activity},0,${start},140,300),(${activity},1,${new Date(start.getTime()+1000)},141,301)`;
    mocks.open.mockResolvedValue({ auth: {kind:"session",session:{refreshed:true}}, client: {
      httpClient: { get: mocks.get, client: { defaults: {}, interceptors: { response: { clear: vi.fn() } } } },
    } });
    mocks.get.mockResolvedValue(payload);
    argv = process.argv;
    output = vi.spyOn(console,"log").mockImplementation(() => {});
    errors = vi.spyOn(console,"error").mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(async () => {
    process.argv = argv; process.exitCode = 0;
    output.mockRestore(); errors.mockRestore(); vi.unstubAllEnvs();
    await sql`set search_path to public`;
    await sql`drop schema ${sql(schema)} cascade`; await sql.end();
  });
  async function run(...args: string[]): Promise<void> {
    vi.resetModules();
    process.argv = ["node","backfill-running-dynamics.ts","--email","runner@example.test",...args];
    const script = await import("../../scripts/backfill-running-dynamics");
    await script.execution;
  }
  it("previews without schema/checkpoint/auth/connection writes, even before checkpoint migration", async () => {
    await sql`drop table garmin_dynamics_backfill`;
    const before = await sql`select * from garmin_connections`;
    const samples = await sql`select * from activity_samples order by elapsed_seconds`;
    await run();
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    expect(await sql`select * from garmin_connections`).toEqual(before);
    expect(await sql`select * from activity_samples order by elapsed_seconds`).toEqual(samples);
    expect(output.mock.calls[0][0]).toContain('"maximumDetailRequests":0');
    expect((await sql`select to_regclass('garmin_dynamics_backfill') as name`)[0].name).toBeNull();
  });
  it("refetches old samples, preserves IDs/provider/user fields and resumes idempotently", async () => {
    const before = await sql`select * from activity_samples order by elapsed_seconds`;
    const runBefore = await sql`select * from run_activities`;
    await run("--apply");
    expect(errors).not.toHaveBeenCalled();
    expect(await sql`select * from run_activities`).toEqual(runBefore);
    const rows = await sql`select * from activity_samples order by elapsed_seconds`;
    expect(rows.map(({id,timestamp,heart_rate,power}) => ({id,timestamp,heart_rate,power})))
      .toEqual(before.map(({id,timestamp,heart_rate,power}) => ({id,timestamp,heart_rate,power})));
    expect(rows[0]).toMatchObject({vertical_oscillation_cm:6.44,stride_length_cm:109.14,ground_contact_balance_left_percent:null});
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"succeeded",attempts:1,sample_count:2,
      coverage:{vertical_oscillation_cm:2,stride_length_cm:1,ground_contact_balance_left_percent:0}});
    const [auth] = await sql`select * from garmin_connections`;
    expect(decryptGarminTokens(auth.encrypted_tokens)).toEqual({kind:"session",session:{refreshed:true}});
    await run("--apply"); expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(await sql`select * from activity_samples order by elapsed_seconds`).toEqual(rows);
  });
  it("records absent descriptors as terminal unavailable, not an endless balance retry", async () => {
    mocks.get.mockResolvedValue({...payload,metricDescriptors:[{key:"directElapsedTime",metricsIndex:0}]});
    await run("--apply"); await run("--apply");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect((await sql`select * from garmin_dynamics_backfill`)[0].status).toBe("unavailable");
  });
  it("accepts a verified zero-row detail only without contradictory stored samples", async () => {
    mocks.get.mockResolvedValue({totalMetricsCount:0,metricDescriptors:[],activityDetailMetrics:[]});
    await sql`delete from activity_samples`;
    await run("--apply");
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"unavailable",sample_count:0});
  });
  it("inserts actual dynamics/time rows for a run without prior samples", async () => {
    await sql`delete from activity_samples`;
    await run("--apply");
    expect(errors).not.toHaveBeenCalled();
    expect(await sql`select * from activity_samples order by elapsed_seconds`).toMatchObject([
      {elapsed_seconds:0,vertical_oscillation_cm:6.44,heart_rate:null,power:null},
      {elapsed_seconds:1,vertical_oscillation_cm:6.45,heart_rate:null,power:null},
    ]);
  });
  it("does not certify truncated/summary-only results and bounds persisted retry attempts", async () => {
    mocks.get.mockResolvedValue({summaryDTO:{verticalOscillation:6.44}});
    const before = await sql`select * from activity_samples order by elapsed_seconds`;
    await run("--apply");
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(await sql`select * from activity_samples order by elapsed_seconds`).toEqual(before);
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"failed",attempts:3,error_code:"incomplete_detail"});
    await run("--apply"); expect(mocks.get).toHaveBeenCalledTimes(3);
  });
  it("recovers an interrupted running checkpoint but refuses changed sample alignment atomically", async () => {
    await sql`insert into garmin_dynamics_backfill(activity_id,version,status,attempts) values (${activity},'dynamics-detail-v1','running',1)`;
    await sql`update activity_samples set timestamp=timestamp+interval '1 second' where elapsed_seconds=1`;
    const before = await sql`select * from activity_samples order by elapsed_seconds`;
    await run("--apply");
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(await sql`select * from activity_samples order by elapsed_seconds`).toEqual(before);
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"failed",error_code:"stored_alignment_changed"});
  });
  it("detects changed counts after terminal success and never deletes unmatched rows", async () => {
    await run("--apply");
    await sql`insert into activity_samples(activity_id,elapsed_seconds,timestamp,power) values (${activity},2,${new Date(start.getTime()+2000)},302)`;
    await run("--apply");
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"failed",error_code:"stored_alignment_changed"});
    expect(await sql`select * from activity_samples`).toHaveLength(3);
  });
  it("backs off 429 responses then succeeds; sanitized output contains no provider error", async () => {
    mocks.get.mockRejectedValueOnce({response:{status:429,headers:{"retry-after":"30"}},secret:"private"}).mockResolvedValue(payload);
    await run("--apply");
    expect(mocks.delay).toHaveBeenCalledWith(30000,undefined,expect.anything());
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"succeeded",attempts:2});
    expect(JSON.stringify(output.mock.calls)).not.toContain("private");
  });
  it("defers long provider waits durably and requires explicit retries after budget exhaustion", async () => {
    mocks.get.mockRejectedValueOnce({response:{status:429,headers:{"retry-after":"3600"}}});
    await run("--apply");
    expect(mocks.get).toHaveBeenCalledTimes(1); expect(mocks.delay).not.toHaveBeenCalled();
    const [checkpoint] = await sql`select * from garmin_dynamics_backfill`;
    expect(new Date(checkpoint.next_retry_at).getTime()).toBeGreaterThan(Date.now()+3500_000);
    await run("--apply","--retry-failed"); expect(mocks.get).toHaveBeenCalledTimes(1);
    await sql`update garmin_dynamics_backfill set attempts=3,next_retry_at=now()-interval '1 second'`;
    await run("--apply"); expect(mocks.get).toHaveBeenCalledTimes(1);
    mocks.get.mockResolvedValue(payload);
    await run("--apply","--retry-failed");
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"succeeded",attempts:4});
  });
  it("does not steal an existing worker, including an expired owner", async () => {
    await sql`update garmin_connections set active_worker_token='other', active_job_id=${crypto.randomUUID()}, active_job_lease_expires_at=now()-interval '1 hour'`;
    const before = await sql`select * from garmin_connections`;
    await run("--apply");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(await sql`select * from garmin_connections`).toEqual(before);
  });
  it("recovers only a dead backfill's expired lease and running checkpoint", async () => {
    await sql`update garmin_connections set active_worker_token='dynamics:dead-process', active_job_lease_expires_at=now()-interval '1 hour'`;
    await sql`insert into garmin_dynamics_backfill(activity_id,version,status,attempts) values (${activity},'dynamics-detail-v1','running',1)`;
    await run("--apply");
    expect(errors).not.toHaveBeenCalled();
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"succeeded",attempts:2});
    expect((await sql`select * from garmin_connections`)[0].active_worker_token).toBeNull();
  });
  it("respects the shared advisory lock even when its own old lease has expired", async () => {
    await sql`select pg_advisory_lock(hashtext(${`garmin-export:${user}`}))`;
    try {
      await sql`update garmin_connections set active_worker_token='dynamics:alive-process', active_job_lease_expires_at=now()-interval '1 hour'`;
      await run("--apply");
      expect(mocks.open).not.toHaveBeenCalled();
      expect((await sql`select * from garmin_connections`)[0].active_worker_token).toBe("dynamics:alive-process");
    } finally { await sql`select pg_advisory_unlock(hashtext(${`garmin-export:${user}`}))`; }
  });
  it("does not clear a new owner's lease or overwrite newer tokens", async () => {
    mocks.get.mockImplementationOnce(async () => {
      await sql`update garmin_connections set active_worker_token='new-owner',encrypted_tokens='newer-tokens'`;
      return payload;
    });
    await run("--apply");
    expect((await sql`select * from garmin_connections`)[0]).toMatchObject({active_worker_token:"new-owner",encrypted_tokens:"newer-tokens"});
    expect((await sql`select * from garmin_dynamics_backfill`)[0].status).toBe("running");
    expect((await sql`select * from activity_samples`)[0].vertical_oscillation_cm).toBeNull();
  });
  it("parks refreshed MFA auth and releases only its own lease", async () => {
    const pending = {kind:"mfa" as const,cookies:"private-cookie",method:"email"};
    mocks.open.mockRejectedValue(new GarminMfaRequiredError(pending as ConstructorParameters<typeof GarminMfaRequiredError>[0]));
    await run("--apply");
    const [auth] = await sql`select * from garmin_connections`;
    expect(auth.status).toBe("mfa_required"); expect(auth.active_worker_token).toBeNull();
    expect(decryptGarminTokens(auth.encrypted_tokens)).toEqual(pending);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private-cookie");
  });
  it("stops on an auth failure and leaves detail retryable", async () => {
    mocks.get.mockRejectedValue({response:{status:401},secret:"private-token"});
    await run("--apply");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect((await sql`select * from garmin_dynamics_backfill`)[0]).toMatchObject({status:"failed",error_code:"auth_required"});
    expect(JSON.stringify(output.mock.calls)).not.toContain("private-token");
  });
  it("finishes an in-flight activity on cancellation and resumes without refetch", async () => {
    mocks.get.mockImplementationOnce(async () => { process.emit("SIGINT"); return payload; });
    await run("--apply");
    expect((await sql`select * from garmin_dynamics_backfill`)[0].status).toBe("succeeded");
    expect((await sql`select * from garmin_connections`)[0].active_worker_token).toBeNull();
    await run("--apply"); expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
