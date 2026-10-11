/** Run history ownership, complete source coverage, pagination, and token isolation. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), select: vi.fn(), scores: vi.fn(), serialize: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/analytics/run-score-persistence", () => ({ loadRunScores: mocks.scores }));
vi.mock("@/lib/activities/serialize", () => ({ serializeRunActivity: mocks.serialize }));
import { GET } from "@/app/api/activities/route";
import { GET as sharedDetail } from "@/app/api/run/[token]/activities/[id]/route";

function query(rows: unknown[]) {
  const builder = {
    from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  for (const method of [builder.from, builder.where, builder.orderBy, builder.limit, builder.offset]) method.mockReturnValue(builder);
  mocks.select.mockReturnValueOnce(builder);
  return builder;
}

function condition(value: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(value);
}

describe("All-run history API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ id: "athlete-a" });
    mocks.serialize.mockImplementation((row) => row);
    mocks.scores.mockResolvedValue(new Map([["unassigned", { score: 10, partial: true }]]));
  });

  it("requires authentication before accessing runs", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://example.com/api/activities"));
    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("includes unassigned and non-Garmin runs with scores while scoping to the athlete", async () => {
    const total = query([{ total: 125 }]);
    const rows = query([{ id: "unassigned", planId: null, source: "manual", sampleCount: 0 }]);
    const response = await GET(new NextRequest("https://example.com/api/activities?page=2"));
    expect(await response.json()).toMatchObject({
      total: 125, page: 2, pageSize: 50,
      activities: [{ id: "unassigned", planId: null, source: "manual", runScore: { score: 10, partial: true } }],
    });
    const where = condition(total.where.mock.calls[0][0]);
    expect(where.params).toEqual(["athlete-a"]);
    expect(where.sql).toContain('"user_id"');
    expect(where.sql).not.toContain('"source"');
    expect(where.sql).not.toContain('"plan_id"');
    expect(rows.limit).toHaveBeenCalledWith(50);
    expect(rows.offset).toHaveBeenCalledWith(50);
  });

  it("filters unassigned runs and clamps an out-of-range page", async () => {
    const total = query([{ total: 2 }]);
    const rows = query([]);
    const response = await GET(new NextRequest("https://example.com/api/activities?plan=unassigned&page=999&q=Morning"));
    expect(await response.json()).toMatchObject({ page: 1, total: 2 });
    const where = condition(total.where.mock.calls[0][0]);
    expect(where.sql).toContain('"plan_id" is null');
    expect(where.params).toEqual(["athlete-a", "%Morning%"]);
    expect(rows.offset).toHaveBeenCalledWith(0);
  });

  it("loads a deep-linked run beyond the page with a separate ownership check", async () => {
    query([{ total: 100 }]);
    query([]);
    const selected = query([{ id: "unassigned", planId: null }]);
    const response = await GET(new NextRequest("https://example.com/api/activities?run=unassigned"));
    expect(await response.json()).toMatchObject({ selectedActivity: { id: "unassigned", runScore: { partial: true } } });
    expect(condition(selected.where.mock.calls[0][0]).params).toEqual(["athlete-a", "unassigned"]);
  });

  it("does not expose another activity through a valid single-run token", async () => {
    const lookup = query([]);
    const response = await sharedDetail(new Request("https://example.com"), {
      params: Promise.resolve({ token: "valid-token", id: "another-run" }),
    });
    expect(response.status).toBe(404);
    const where = condition(lookup.where.mock.calls[0][0]);
    expect(where.params).toEqual(["another-run", "valid-token"]);
    expect(where.sql).toContain('"share_token"');
    expect(mocks.scores).not.toHaveBeenCalled();
  });
});
