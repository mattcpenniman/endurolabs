/** Private steps routes use the signed-in owner, validate ranges and protect writes. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/garmin/daily-steps-sync", () => ({ loadDailySteps: mocks.load, syncDailySteps: mocks.sync,
  StepsSyncUnavailable: class extends Error { constructor(message: string, readonly status: number) { super(message); } } }));
import { GET, POST } from "@/app/api/integrations/garmin/steps/route";
import { StepsSyncUnavailable } from "@/lib/garmin/daily-steps-sync";
const range = { startDate: "2026-03-01", endDate: "2026-03-07" };
function post(body: unknown = range, origin?: string): NextRequest {
  return new NextRequest("https://example.test/api/integrations/garmin/steps", { method: "POST", body: JSON.stringify(body), headers: origin ? { Origin: origin } : {} });
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "owner" }); mocks.load.mockResolvedValue([]); mocks.sync.mockResolvedValue({ days: [], skippedByTtl: true }); });
describe("daily steps API", () => {
  it("requires auth for reading and importing", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(post())).status).toBe(401); expect((await POST(post())).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("only loads signed-in owner's data, not supplied user or plan IDs; never caches", async () => {
    const response = await GET(new NextRequest(`https://example.test/api/integrations/garmin/steps?${new URLSearchParams(range)}&userId=other`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.load).toHaveBeenCalledWith("owner", range);
  });
  it("uses the same owner for ingestion", async () => {
    expect((await POST(post({ ...range, userId: "other" }))).status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith("owner", range);
  });
  it("rejects foreign origins and malformed or unbounded ranges", async () => {
    expect((await POST(post(range, "https://evil.test"))).status).toBe(403);
    for (const body of [null, {}, { ...range, endDate: "2026-04-01" }]) expect((await POST(post(body))).status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("surfaces busy connections but never returns raw transport errors", async () => {
    mocks.sync.mockRejectedValue(new StepsSyncUnavailable("Garmin is syncing", 409));
    expect((await POST(post())).status).toBe(409);
    mocks.sync.mockRejectedValue(new Error("secret payload"));
    const response = await POST(post()); expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
