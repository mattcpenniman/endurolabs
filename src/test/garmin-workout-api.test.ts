/** Workout sync authenticates, checks saved source/ownership and commits durable state. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), reserve: vi.fn(), sync: vi.fn(), restore: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ conn: { reserve: mocks.reserve } }));
vi.mock("@/lib/garmin/workout-sync", () => ({ syncGarminWorkout: mocks.sync }));
vi.mock("garmin-connect-client", () => ({ createFromSession: mocks.restore }));
vi.mock("@/lib/garmin/crypto", () => ({ decryptGarminTokens: mocks.decrypt }));
import { GET, POST } from "@/app/api/plan/[id]/garmin-workout/route";
import type { WorkoutSyncJournal, WorkoutSyncVersion } from "@/lib/garmin/workout-sync";

const id = "12345678-1234-4123-8123-123456789012";
const context = { params: Promise.resolve({ id }) };
const workout = { id: "easy-w1", title: "Easy", type: "easy", description: "Easy run", totalDistance: 5,
  estimatedDuration: 40, weeklyMileageContribution: 5, segments: [{ type: "easy", distance: 5, pace: 8, description: "Easy" }] };
const body = { workoutId: workout.id, date: "2027-02-16", expectedWorkout: workout };
function request(value: unknown = body, origin?: string): NextRequest {
  return new NextRequest(`https://example.test/api/plan/${id}/garmin-workout`, {
    method: "POST", body: JSON.stringify(value), headers: origin ? { Origin: origin } : {},
  });
}
function database(options: { owned?: boolean; locked?: boolean; connected?: boolean } = {}) {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("pg_try_advisory_lock")) return [{ ok: options.locked !== false }];
    if (query.includes("from plans")) return options.owned === false ? [] : [{ plan_data: { weeks: [{ days: [{ date: body.date, workout, isRestDay: false }] }] } }];
    if (query.includes("from garmin_workout_exports")) return [];
    if (query.includes("from garmin_connections")) return options.connected === false ? [] : [{ encrypted_tokens: "sealed", status: "connected" }];
    return [];
  }), { release: vi.fn(), json: vi.fn((value: unknown) => value) });
  mocks.reserve.mockResolvedValue(sql);
  return sql;
}
describe("Planned Garmin workout API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ id: "athlete-a" });
    mocks.decrypt.mockReturnValue({ kind: "session", session: { oauth2Token: { expires_at: Date.now() / 1000 + 3600 } } });
    mocks.restore.mockReturnValue({ httpClient: { client: { defaults: {}, interceptors: { response: { clear: vi.fn() } } } } });
    mocks.sync.mockImplementation(async (_transport: unknown, journal: WorkoutSyncJournal, version: WorkoutSyncVersion) => {
      await journal.save({ confirmed: { ...version, workoutId: 42 } });
      return { workoutId: 42, date: version.date, verified: true };
    });
  });
  it("requires authentication before acquiring a connection", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect((await GET(request(), context)).status).toBe(401);
  });
  it("reads owner-scoped durable full-plan status without contacting Garmin", async () => {
    const sql = database();
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ entries: [{ workout, date: body.date, status: "not_synced" }], removedExports: 0 });
    expect(sql.mock.calls.filter(([parts]) => parts.join("").includes("where user_id"))[0]?.slice(1)).toEqual(["athlete-a", id]);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(sql.release).toHaveBeenCalledOnce();
  });
  it("does not reveal another owner's plan sync status", async () => {
    database({ owned: false });
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and invalid target selection", async () => {
    expect((await POST(request(body, "https://attacker.test"), context)).status).toBe(403);
    expect((await POST(request({ ...body, target: "hr" }), context)).status).toBe(400);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("scopes the lookup to the owner and never publishes a non-owned plan", async () => {
    const sql = database({ owned: false });
    expect((await POST(request(), context)).status).toBe(404);
    const lookup = sql.mock.calls.find(([parts]) => parts.join("").includes("from plans"));
    expect(lookup?.slice(1)).toEqual([id, "athlete-a"]);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(sql.release).toHaveBeenCalledOnce();
  });
  it.each([{ ...body, date: "2027-02-18" }, { ...body, expectedWorkout: { ...workout, totalDistance: 6 } }])("rejects unsaved/newer versions", async (value) => {
    database();
    expect((await POST(request(value), context)).status).toBe(409);
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it("compares JSON objects independently of JSONB property ordering, commits state and returns verified link", async () => {
    const sql = database();
    const reordered = Object.fromEntries(Object.entries(workout).reverse());
    const response = await POST(request({ ...body, expectedWorkout: reordered }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workoutId: 42, verified: true, url: "https://connect.garmin.com/modern/workout/42" });
    expect(sql.mock.calls.some(([parts]) => parts.join("").includes("insert into garmin_workout_exports"))).toBe(true);
    expect(sql.release).toHaveBeenCalledOnce();
  });
  it("serializes athlete exports without calling Garmin when another owns the lock", async () => {
    const sql = database({ locked: false });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(sql.release).toHaveBeenCalledOnce();
  });
  it("asks for a Garmin connection without publishing", async () => {
    database({ connected: false });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Connect Garmin");
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("does not expose provider request config or database errors", async () => {
    database();
    mocks.sync.mockRejectedValue({ isAxiosError: true, message: "secret token", config: { Authorization: "secret" } });
    const provider = await POST(request(), context);
    expect(JSON.stringify(await provider.json())).not.toContain("secret");
    mocks.sync.mockRejectedValue(new Error("insert into garmin_workout_exports: database secret"));
    const internal = await POST(request(), context);
    expect(JSON.stringify(await internal.json())).not.toContain("database secret");
  });
});
