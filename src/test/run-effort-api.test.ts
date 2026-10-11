/** Effort overrides are validated and written only to the authenticated owner's run. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), update: vi.fn(), scores: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/db/client", () => ({ db: { update: mocks.update } }));
vi.mock("@/lib/analytics/run-score-persistence", () => ({ loadRunScores: mocks.scores }));
import { PATCH } from "@/app/api/activities/[id]/route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://example.test/api/activities/run-a", { method: "PATCH", body: JSON.stringify(body) });
}
const context = { params: Promise.resolve({ id: "run-a" }) };
describe("Run Score effort setting", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "athlete-a" }); });
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await PATCH(request({ effortOverride: "easy" }), context)).status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["race", "", 5, false, {}])("rejects invalid effort %s before writing", async (value) => {
    expect((await PATCH(request({ effortOverride: value }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["easy", "threshold", null])("saves %s, scopes ownership and returns a fresh score", async (effortOverride) => {
    const row = { id: "run-a", userId: "athlete-a", effortOverride };
    const query = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([row]) };
    query.set.mockReturnValue(query); query.where.mockReturnValue(query); mocks.update.mockReturnValue(query);
    mocks.scores.mockResolvedValue(new Map([["run-a", { effort: effortOverride ?? "easy" }]]));
    const response = await PATCH(request({ effortOverride }), context);
    expect(response.status).toBe(200);
    expect(query.set).toHaveBeenCalledWith(expect.objectContaining({ effortOverride }));
    expect(new PgDialect().sqlToQuery(query.where.mock.calls[0][0]).params).toEqual(["run-a", "athlete-a"]);
    expect(mocks.scores).toHaveBeenCalledWith([row]);
    expect(await response.json()).toMatchObject({ runScore: { effort: effortOverride ?? "easy" } });
  });
  it("does not recompute or expose a non-owned run", async () => {
    const query = { set: vi.fn(), where: vi.fn(), returning: vi.fn().mockResolvedValue([]) };
    query.set.mockReturnValue(query); query.where.mockReturnValue(query); mocks.update.mockReturnValue(query);
    expect((await PATCH(request({ effortOverride: "easy" }), context)).status).toBe(404);
    expect(mocks.scores).not.toHaveBeenCalled();
  });
});
