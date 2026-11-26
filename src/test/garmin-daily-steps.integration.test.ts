// @vitest-environment node
/** Real PostgreSQL integration; synthetic database only, Garmin and token transport mocked. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
const mocks = vi.hoisted(() => {
  if (process.env.STEPS_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.STEPS_TEST_DATABASE_URL;
  return { fetch: vi.fn(), open: vi.fn() };
});
vi.mock("@/lib/garmin/client", () => ({ fetchDailySteps: mocks.fetch, openGarminSession: mocks.open }));
vi.mock("@/lib/garmin/crypto", () => ({ decryptGarminTokens: () => ({ kind: "session", session: {} }), encryptGarminTokens: () => "synthetic-refreshed" }));
import { db, endDb } from "@/lib/db/client";
import { users, garminConnections, garminDailySteps } from "@/lib/db/schema";
import { loadDailySteps, syncDailySteps } from "@/lib/garmin/daily-steps-sync";
const suite = process.env.STEPS_TEST_DATABASE_URL ? describe : describe.skip;
const owner = randomUUID(), other = randomUUID();
const range = { startDate: "2026-03-01", endDate: "2026-03-03" };
suite("daily steps PostgreSQL ingestion", () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, owner)); await db.delete(users).where(eq(users.id, other));
    await db.insert(users).values([owner, other].map((id) => ({ id, email: `${id}@test.invalid`, passwordHash: "synthetic" })));
    await db.insert(garminConnections).values({ userId: owner, garminUsername: "test", encryptedTokens: "synthetic" });
    mocks.open.mockReset().mockResolvedValue({ client: {}, auth: { kind: "session", session: {} } });
    mocks.fetch.mockReset().mockResolvedValue([{ calendarDate: "2026-03-01", totalSteps: 12345 }, { calendarDate: "2026-03-03", totalSteps: 0 }]);
  });
  afterAll(async () => {
    await db.delete(users).where(eq(users.id, owner)); await db.delete(users).where(eq(users.id, other)); await endDb();
  });
  it("upserts and checkpoints missing days, scopes to owner, refreshes corrections without duplicates", async () => {
    expect(await syncDailySteps(owner, range)).toMatchObject({ skippedByTtl: false, days: [
      { localDate: "2026-03-01", totalSteps: 12345 }, { localDate: "2026-03-03", totalSteps: 0 },
    ] });
    expect(await loadDailySteps(other, range)).toEqual([]);
    expect((await syncDailySteps(owner, range)).skippedByTtl).toBe(true); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await db.update(garminDailySteps).set({ fetchedAt: new Date(0) }).where(eq(garminDailySteps.userId, owner));
    mocks.fetch.mockResolvedValue([{ calendarDate: "2026-03-01", totalSteps: 15000 }]);
    await syncDailySteps(owner, range);
    expect(await loadDailySteps(owner, range)).toEqual([{ localDate: "2026-03-01", totalSteps: 15000 }, { localDate: "2026-03-03", totalSteps: 0 }]);
    expect(await db.select().from(garminDailySteps).where(eq(garminDailySteps.userId, owner))).toHaveLength(3);
    const [connection] = await db.select().from(garminConnections).where(eq(garminConnections.userId, owner));
    expect(connection.activeWorkerToken).toBeNull(); expect(connection.encryptedTokens).toBe("synthetic-refreshed");
  });
  it("does not steal another worker's lease", async () => {
    await db.update(garminConnections).set({ activeWorkerToken: "existing", activeJobLeaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(garminConnections.userId, owner));
    await expect(syncDailySteps(owner, range)).rejects.toMatchObject({ status: 409 }); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("refuses missing connections and future dates before contacting Garmin", async () => {
    await expect(syncDailySteps(other, range)).rejects.toMatchObject({ status: 409 });
    await expect(syncDailySteps(owner, { startDate: "2999-01-01", endDate: "2999-01-02" })).rejects.toMatchObject({ status: 400 });
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("clears its lease if restoring the existing session fails", async () => {
    mocks.open.mockRejectedValue(new Error("expired"));
    await expect(syncDailySteps(owner, range)).rejects.toThrow("expired");
    const [connection] = await db.select().from(garminConnections).where(eq(garminConnections.userId, owner));
    expect(connection.activeWorkerToken).toBeNull(); expect(connection.encryptedTokens).toBe("synthetic");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("releases only its own lease on provider failure without recording missing data", async () => {
    mocks.fetch.mockRejectedValue(new Error("provider failure"));
    await expect(syncDailySteps(owner, range)).rejects.toThrow();
    expect(await db.select().from(garminDailySteps).where(eq(garminDailySteps.userId, owner))).toEqual([]);
    const [connection] = await db.select().from(garminConnections).where(eq(garminConnections.userId, owner));
    expect(connection.activeWorkerToken).toBeNull(); expect(connection.status).toBe("connected");
  });
  it("rejects malformed history atomically and retains existing totals", async () => {
    await syncDailySteps(owner, range);
    await db.update(garminDailySteps).set({ fetchedAt: new Date(0) }).where(eq(garminDailySteps.userId, owner));
    mocks.fetch.mockResolvedValue([{ calendarDate: "2026-03-01", totalSteps: 888 }, { calendarDate: "2026-03-02", totalSteps: -1 }]);
    await expect(syncDailySteps(owner, range)).rejects.toThrow();
    expect((await loadDailySteps(owner, range))[0].totalSteps).toBe(12345);
  });
  it("requests only missing dates between finalized saved totals", async () => {
    await syncDailySteps(owner, range);
    await db.update(garminDailySteps).set({ fetchedAt: new Date(0) }).where(and(
      eq(garminDailySteps.userId, owner), eq(garminDailySteps.localDate, "2026-03-02"),
    ));
    mocks.fetch.mockClear().mockResolvedValue([{ calendarDate: "2026-03-02", totalSteps: 456 }]);
    await syncDailySteps(owner, range);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith({}, "2026-03-02", "2026-03-02");
    expect(await loadDailySteps(owner, range)).toEqual([
      { localDate: "2026-03-01", totalSteps: 12345 }, { localDate: "2026-03-02", totalSteps: 456 }, { localDate: "2026-03-03", totalSteps: 0 },
    ]);
    mocks.open.mockClear(); mocks.fetch.mockClear();
    expect((await syncDailySteps(owner, range)).skippedByTtl).toBe(true);
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not finalize a same-day partial total after an empty provider response", async () => {
    const partialFetchedAt = new Date("2026-03-01T18:00:00Z");
    await db.insert(garminDailySteps).values({ userId: owner, localDate: "2026-03-01", totalSteps: 1000, fetchedAt: partialFetchedAt });
    mocks.fetch.mockResolvedValue([]);
    await syncDailySteps(owner, { startDate: "2026-03-01", endDate: "2026-03-01" });
    const [saved] = await db.select().from(garminDailySteps).where(eq(garminDailySteps.userId, owner));
    expect(saved.totalSteps).toBe(1000); expect(saved.fetchedAt).toEqual(partialFetchedAt);
    mocks.fetch.mockClear().mockResolvedValue([{ calendarDate: "2026-03-01", totalSteps: 2345 }]);
    await syncDailySteps(owner, { startDate: "2026-03-01", endDate: "2026-03-01" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(await loadDailySteps(owner, range)).toEqual([{ localDate: "2026-03-01", totalSteps: 2345 }]);
  });
  it("fences writes and cleanup after another worker takes ownership", async () => {
    mocks.fetch.mockImplementation(async () => {
      await db.update(garminConnections).set({ activeWorkerToken: "replacement" }).where(eq(garminConnections.userId, owner));
      return [{ calendarDate: "2026-03-01", totalSteps: 500 }];
    });
    await expect(syncDailySteps(owner, range)).rejects.toMatchObject({ status: 409 });
    expect(await loadDailySteps(owner, range)).toEqual([]);
    const [connection] = await db.select().from(garminConnections).where(and(eq(garminConnections.userId, owner), eq(garminConnections.activeWorkerToken, "replacement")));
    expect(connection).toBeDefined();
  });
});
