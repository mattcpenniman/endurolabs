/** Owner and deliberately supported public serializers aggregate full detail, never summaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ActivityDetailResponse } from "@/lib/activities/models";

const mocks = vi.hoisted(() => ({ select: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/analytics/run-score-persistence", () => ({ loadRunScores: async () => new Map() }));
import { GET as owned } from "@/app/api/activities/[id]/route";
import { GET as run } from "@/app/api/run/[token]/activities/[id]/route";
import { GET as race } from "@/app/api/race/[token]/activities/[id]/route";
import { GET as plan } from "@/app/api/share/[token]/activities/[id]/route";

function result(rows: unknown[]): void {
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn(), orderBy: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(rows);
  query.orderBy.mockResolvedValue(rows);
  mocks.select.mockReturnValueOnce(query);
}

describe("dynamics detail serializers", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "owner" }); });
  it.each([["owner", owned], ["run", run], ["race", race], ["plan", plan]] as const)(
    "%s includes full-resolution weighted dynamics and split coverage before decimation", async (kind, get) => {
      if (kind === "plan") result([{ id: "plan" }]);
      result([{ id: "activity", durationSeconds: 2400, distanceMeters: 7200, powerSource: "garmin", planId: null,
        strideLengthCm: 999, groundContactBalanceLeftPercent: 50.79 }]);
      result(Array.from({ length: 2401 }, (_, elapsedSeconds) => ({ elapsedSeconds,
        speedMetersPerSecond: 3, heartRate: 140, power: 300, cadence: 90,
        strideLengthCm: elapsedSeconds % 2 ? 200 : 100, verticalOscillationCm: 6.44,
        verticalRatioPercent: 5.71, groundContactTimeMs: 272.3, groundContactBalanceLeftPercent: null,
      })));
      const response = await get(new NextRequest("http://localhost/api/detail"), { params: Promise.resolve({ id: "activity", token: "token" }) });
      expect(response.status).toBe(200);
      const body = await response.json() as ActivityDetailResponse;
      expect(body.samples).toHaveLength(1200);
      expect(body.dynamics?.metrics.strideLengthCm.average).toBeCloseTo(150);
      expect(body.dynamics?.metrics.groundContactBalanceLeftPercent.average).toBeNull();
      expect(body.dynamics?.metrics.strideLengthCm.validSeconds).toBe(2400);
      expect(body.splitOptions?.kilometer[0].dynamics?.metrics.strideLengthCm.average).toBeCloseTo(150, 0);
      expect(body.dynamics?.bins.length).toBeLessThanOrEqual(360);
      expect(body.runScore).toBeNull();
    });

  it("does not query detail for unauthenticated owner requests", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await owned(new NextRequest("http://localhost/api/detail"), { params: Promise.resolve({ id: "activity" }) });
    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([["owner", owned], ["run", run], ["race", race], ["plan", plan]] as const)(
    "%s rejects unavailable ownership/share scopes before reading samples", async (_kind, get) => {
      result([]);
      const response = await get(new NextRequest("http://localhost/api/detail"), { params: Promise.resolve({ id: "activity", token: "invalid" }) });
      expect(response.status).toBe(404);
      expect(mocks.select).toHaveBeenCalledTimes(1);
    });
});
