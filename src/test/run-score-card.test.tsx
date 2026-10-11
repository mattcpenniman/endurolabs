import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import type { RunActivity } from "@/lib/activities/models";
import { buildRunScore } from "@/lib/analytics/run-score";

vi.mock("@/app/components/plan/GarminActivityLeafletMap", () => ({ default: () => <div>Map</div> }));
function activity(id: string, cadence: number | null): RunActivity {
  return { id, providerActivityId: id, source: "garmin", powerSource: "garmin", activityName: `Run ${id}`,
    activityType: "running", eventType: null, localDate: "2026-10-01", startTimeLocal: "2026-10-01T08:00:00",
    startTimeGmt: "2026-10-01T08:00:00Z", distanceMiles: 3, durationSeconds: 1800, movingDurationSeconds: null,
    averagePaceMinutesPerMile: 10, elevationGainMeters: null, averageHeartRate: null, maxHeartRate: null,
    averageCadence: cadence, garminPower: null, calculatedPower: null, averagePower: null, averagePowerEstimated: false,
    calories: null, deviceName: null, planId: null, weekNumber: null, dayOfWeek: null, plannedWorkoutId: null,
    matchConfidence: null, sampleCount: 0, samplesFetchedAt: null, syncedAt: "2026-10-01T08:00:00Z",
    runScore: buildRunScore({ distanceMeters: 4828, durationSeconds: 1800, movingDurationSeconds: null,
      averageCadence: cadence, powerSource: "garmin", samples: [], plan: null, workout: null }) };
}

describe("Run card score tab", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ samples: [], splits: [] }) })));
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("opens summary-only runs and shows omitted components as unavailable, not zero", async () => {
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("summary-only", 180)]} />));
    const scoreTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Score")!;
    await act(async () => scoreTab.click());
    expect(scoreTab.getAttribute("aria-selected")).toBe("true");
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.textContent).toContain("10.0/10 · partial");
    expect(panel.textContent).toContain("No matched workout with usable targets");
    expect(panel.textContent).toContain("remaining weights are renormalized");
    expect([...panel.querySelectorAll("p")].map((element) => element.textContent)).not.toContain("0.0/10");
  });

  it("updates score details when another run is selected", async () => {
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("scored", 180), activity("missing", null)]} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Score")!.click());
    const picker = container.querySelector("select")!;
    await act(async () => { picker.value = "missing"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.textContent).toContain("No valid cadence recorded");
    expect(panel.textContent).not.toContain("10.0/10");
  });
});
