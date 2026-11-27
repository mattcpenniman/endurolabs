/** Connection badges use full scoped aggregates while activity loading stays bounded. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), select: vi.fn(), scores: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/analytics/run-score-persistence", () => ({ loadRunScores: mocks.scores }));
vi.mock("@/lib/activities/serialize", () => ({ serializeRunActivity: (row: unknown) => row }));
vi.mock("@/lib/garmin/client", () => ({}));
vi.mock("@/lib/garmin/crypto", () => ({}));
import { GET } from "@/app/api/integrations/garmin/route";

const dialect = new PgDialect();
function query(expression: SQL) { return dialect.sqlToQuery(expression); }
function request(search = ""): NextRequest {
  return new NextRequest(`https://example.test/api/integrations/garmin${search}`);
}
function selectResult(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
}
function database(totalActivities = 1234, activitiesWithDetail = 1105, plan?: "owned" | "foreign") {
  const ownership = selectResult(plan === "owned" ? [{ id: "plan-a" }] : []);
  const connection = selectResult([{ status: "connected", garminUsername: "runner@example.test" }]);
  const aggregate = selectResult([{ totalActivities, activitiesWithDetail }]);
  const rows = Array.from({ length: Math.min(1000, totalActivities) }, (_, index) => ({ id: `run-${index}` }));
  const activities = selectResult(rows);
  if (plan) mocks.select.mockReturnValueOnce(ownership);
  mocks.select.mockReturnValueOnce(connection).mockReturnValueOnce(aggregate).mockReturnValueOnce(activities);
  return { ownership, aggregate, activities, rows };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "owner" });
  mocks.scores.mockResolvedValue(new Map());
});

describe("Garmin connection counts", () => {
  it("returns totals above 1000 without increasing the activity/scoring limit", async () => {
    const { aggregate, activities, rows } = database();
    const response = await GET(request("?userId=other"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.totalActivities).toBe(1234);
    expect(body.activitiesWithDetail).toBe(1105);
    expect(body.activities).toHaveLength(1000);
    expect(activities.limit).toHaveBeenCalledWith(1000);
    expect(aggregate.limit).not.toHaveBeenCalled();
    expect(mocks.scores).toHaveBeenCalledWith(rows);
    const scope = query(aggregate.where.mock.calls[0][0]);
    expect(scope.params).toEqual(["owner", "garmin"]);
    expect(scope.sql).toContain('"run_activities"."user_id" =');
    expect(scope.sql).toContain('"run_activities"."source" =');
    expect(activities.where.mock.calls[0][0]).toBe(aggregate.where.mock.calls[0][0]);
  });

  it("counts non-null successful fetch timestamps, not sample rows or sample_count", async () => {
    database();
    await GET(request());
    const fields = mocks.select.mock.calls[1][0] as Record<string, SQL>;
    expect(query(fields.totalActivities).sql).toBe("count(*)");
    expect(query(fields.activitiesWithDetail).sql).toBe('count("run_activities"."samples_fetched_at")');
  });

  it("returns numeric zeros for an owner with no stored Garmin runs", async () => {
    database(0, 0);
    expect(await (await GET(request())).json()).toMatchObject({ totalActivities: 0, activitiesWithDetail: 0, activities: [] });
  });

  it("applies the same owned-plan filter to both totals and activities", async () => {
    const { ownership, aggregate, activities } = database(42, 30, "owned");
    const response = await GET(request("?planId=plan-a"));
    expect(await response.json()).toMatchObject({ totalActivities: 42, activitiesWithDetail: 30 });
    expect(query(ownership.where.mock.calls[0][0]).params).toEqual(["plan-a", "owner"]);
    const scope = query(aggregate.where.mock.calls[0][0]);
    expect(scope.params).toEqual(["owner", "garmin", "plan-a"]);
    expect(scope.sql).toContain('"run_activities"."plan_id" =');
    expect(activities.where.mock.calls[0][0]).toBe(aggregate.where.mock.calls[0][0]);
  });

  it("rejects an unowned plan before reading connection or activity counts", async () => {
    database(1234, 1105, "foreign");
    expect((await GET(request("?planId=plan-a"))).status).toBe(404);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.scores).not.toHaveBeenCalled();
  });

  it("requires authentication before any database access", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
