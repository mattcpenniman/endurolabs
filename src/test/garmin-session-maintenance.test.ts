/** Background OAuth maintenance safety and persistence tests. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), update: vi.fn(), open: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock("@/lib/garmin/client", () => ({ openGarminSession: mocks.open }));
vi.mock("@/lib/garmin/crypto", () => ({
  decryptGarminTokens: mocks.decrypt, encryptGarminTokens: mocks.encrypt,
}));
import { maintainGarminSession } from "@/lib/garmin/session-maintenance";
import { POST } from "@/app/api/internal/garmin-session-maintenance/route";

const connection = { id: "connection", encryptedTokens: "sealed-old" };
const stored = { kind: "session", session: { oauth2Token: { expires_at: 1 } } };
let patches: Record<string, unknown>[];
let claimed: typeof connection[];

beforeEach(() => {
  vi.clearAllMocks();
  patches = [];
  claimed = [connection];
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [connection] }) }) }) });
  mocks.update.mockImplementation(() => ({ set: (patch: Record<string, unknown>) => {
    patches.push(patch);
    return { where: () => ({ returning: async () => claimed }) };
  } }));
  mocks.decrypt.mockReturnValue(stored);
  mocks.open.mockResolvedValue({ auth: { kind: "session", session: "rotated" } });
  mocks.encrypt.mockReturnValue("sealed-new");
});

describe("background session maintenance", () => {
  it("persists rotated auth encrypted, schedules next check, and releases lease without marking activity synced", async () => {
    expect(await maintainGarminSession()).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(stored); // no password/login fallback
    expect(mocks.encrypt).toHaveBeenCalledWith({ kind: "session", session: "rotated" });
    expect(patches[0].activeWorkerToken).toEqual(expect.any(String));
    expect(patches[0].nextTokenCheckAt).toEqual(expect.any(Date));
    expect(patches[1]).toEqual({ encryptedTokens: "sealed-new" });
    expect(patches[2]).toEqual({ activeWorkerToken: null, activeJobLeaseExpiresAt: null });
    expect(patches.some((patch) => "lastSyncAt" in patch || "status" in patch)).toBe(false);
  });

  it("does nothing when no connection is due", async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) });
    expect(await maintainGarminSession()).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("does not refresh when another worker wins the claim", async () => {
    claimed = [];
    expect(await maintainGarminSession()).toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("does not consume pending MFA", async () => {
    mocks.decrypt.mockReturnValue({ kind: "mfa" });
    await maintainGarminSession();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(patches.at(-1)).toEqual({ activeWorkerToken: null, activeJobLeaseExpiresAt: null });
  });

  it("retains old tokens on failure, sanitizes upstream text and releases the lease", async () => {
    mocks.open.mockRejectedValue(new Error("private provider payload"));
    await maintainGarminSession();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(JSON.stringify(patches)).not.toContain("private provider payload");
    expect(patches[1].lastError).toContain("will retry");
    expect(patches.at(-1)).toEqual({ activeWorkerToken: null, activeJobLeaseExpiresAt: null });
  });
});

describe("maintenance endpoint authorization", () => {
  it("rejects a missing or wrong worker secret without touching DB", async () => {
    vi.stubEnv("GARMIN_WORKER_SECRET", "worker-test-secret");
    const response = await POST(new NextRequest("http://localhost/api/internal/garmin-session-maintenance", { method: "POST" }));
    expect(response.status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("allows the protected worker to check one connection", async () => {
    vi.stubEnv("GARMIN_WORKER_SECRET", "worker-test-secret");
    const response = await POST(new NextRequest("http://localhost/api/internal/garmin-session-maintenance", {
      method: "POST", headers: { authorization: "Bearer worker-test-secret" },
    }));
    expect(await response.json()).toEqual({ processed: true });
    vi.unstubAllEnvs();
  });
});
