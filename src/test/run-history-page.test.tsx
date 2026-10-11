/** All-run page integration with the shared run card and partial scores. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunsPage from "@/app/runs/page";
import type { RunActivity } from "@/lib/activities/models";
import { buildRunScore } from "@/lib/analytics/run-score";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: "" }));
const router = { push: navigation.push, replace: navigation.replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("@/app/components/plan/GarminActivityLeafletMap", () => ({ default: () => <div>Map</div> }));

function activity(id: string, planId: string | null): RunActivity {
  return {
    id, providerActivityId: id, source: "garmin", powerSource: "garmin", activityName: `Run ${id}`,
    activityType: "running", eventType: null, localDate: "2026-10-01", startTimeLocal: "2026-10-01T08:00:00",
    startTimeGmt: "2026-10-01T08:00:00Z", distanceMiles: 3, durationSeconds: 1800, movingDurationSeconds: null,
    averagePaceMinutesPerMile: 10, elevationGainMeters: null, averageHeartRate: null, maxHeartRate: null,
    averageCadence: 180, garminPower: null, calculatedPower: null, averagePower: null, averagePowerEstimated: false,
    calories: null, deviceName: null, planId, weekNumber: null, dayOfWeek: null, plannedWorkoutId: null,
    matchConfidence: null, sampleCount: 0, samplesFetchedAt: null, syncedAt: "2026-10-01T08:00:00Z",
    runScore: buildRunScore({ distanceMeters: 4828, durationSeconds: 1800, movingDurationSeconds: null,
      averageCadence: 180, powerSource: "garmin", samples: [], plan: null, workout: null }),
  };
}

describe("Run history page", () => {
  let container: HTMLDivElement;
  let root: Root;
  const clipboard = vi.fn();
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.query = "";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.includes("/share") ? { shareUrl: "https://example.com/run/token" }
        : url.startsWith("/api/activities?") ? {
          activities: [activity("unassigned", null), activity("linked", "plan-a")],
          selectedActivity: null, total: 51, page: 1, pageSize: 50,
        } : { samples: [], splits: [] },
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens and scores unassigned summary-only runs and shares only the selected run", async () => {
    await act(async () => root.render(<RunsPage />));
    const table = container.querySelector("table")!;
    expect(table.textContent).toContain("Run unassigned");
    expect(table.textContent).toContain("No plan");
    expect(table.textContent).toContain("Summary only");
    expect(table.querySelector("a")?.getAttribute("href")).toBe("/plan?plan=plan-a");
    const scoreTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Score")!;
    await act(async () => scoreTab.click());
    expect(container.querySelector('[role="tabpanel"]')!.textContent).toContain("10.0/10 · partial");
    expect(container.querySelector('[role="tabpanel"]')!.textContent).toContain("Easy selected; no configured pace/power zones available");
    const share = [...container.querySelectorAll("button")].find((button) => button.textContent === "Share")!;
    await act(async () => share.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/activities/unassigned/share", { method: "POST" });
    expect(clipboard).toHaveBeenCalledWith("https://example.com/run/token?runmap=unassigned");
  });

  it("navigates filters and pagination without limiting the history to a plan", async () => {
    await act(async () => root.render(<RunsPage />));
    const filter = container.querySelector<HTMLSelectElement>("form select")!;
    await act(async () => { filter.value = "unassigned"; filter.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(navigation.push).toHaveBeenCalledWith("/runs?plan=unassigned", { scroll: false });
    const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "Next")!;
    await act(async () => next.click());
    expect(navigation.push).toHaveBeenCalledWith("/runs?page=2", { scroll: false });
  });

  it("redirects unauthenticated users to sign in with the runs URL preserved", async () => {
    navigation.query = "run=unassigned";
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await act(async () => root.render(<RunsPage />));
    expect(navigation.replace).toHaveBeenCalledWith("/login?redirect=%2Fruns%3Frun%3Dunassigned");
    expect(container.querySelector("table")).toBeNull();
  });
});
