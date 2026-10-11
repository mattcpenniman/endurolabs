import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import type { RunActivity } from "@/lib/activities/models";
import { buildRunScore, summarizeRunScores } from "@/lib/analytics/run-score";
import { RunScoreSummaryBadge } from "@/app/components/plan/RunScoreDetails";

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
    expect(panel.textContent).toContain("Easy selected; no configured pace/power zones available");
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

  it("saves selected effort, refreshes the score and propagates it to aggregate views", async () => {
    const run = activity("effort-edit", 180);
    const updated = { ...run.runScore!, effort: "threshold" as const, effortOverride: "threshold" as const, score: 7 };
    const onScoreChange = vi.fn();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true,
      json: async () => init?.method === "PATCH" ? { runScore: updated } : { samples: [], splits: [], runScore: run.runScore },
    }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<GarminActivityMapCard activities={[run]} onScoreChange={onScoreChange} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Score")!.click());
    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Target effort"]')!;
    await act(async () => { selector.value = "threshold"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fetcher).toHaveBeenCalledWith("/api/activities/effort-edit", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ effortOverride: "threshold" }) }));
    expect(selector.value).toBe("threshold");
    expect(container.textContent).toContain("7.0/10");
    expect(onScoreChange).toHaveBeenCalledWith(run.id, updated);
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Route & splits")!.click());
    expect(container.textContent).toContain("Pace / power goals · Threshold");
  });

  it("keeps shared-run effort read-only", async () => {
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("read-only", 180)]} detailUrlPrefix="/api/run/token/activities" />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Score")!.click());
    expect(container.querySelector('select[aria-label="Target effort"]')).toBeNull();
    expect(container.textContent).toContain("Pace / power goals · Easy");
  });

  it.each(["Week 1", "Base phase"])("opens and closes the %s score breakdown from the icon", async (label) => {
    const summary = summarizeRunScores([activity("scored", 180), activity("missing", null)]);
    await act(async () => root.render(<RunScoreSummaryBadge label={label} summary={summary} />));
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Avg run score 10.0/10 · 1/2 runs · 1 partial");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => button.querySelector("svg")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("aria-label")).toBe(`${label} run score breakdown`);
    expect(panel.textContent).toContain("Cadence · 30%");
    expect(panel.textContent).toContain("Target effort · 50%");
    expect(panel.textContent).toContain("Planned distance · 20%");
    expect(panel.textContent).toContain("0/2 runs with this component");
    expect(panel.textContent).toContain("1 unscored and 1 partial");
    expect([...panel.querySelectorAll("p")].map((element) => element.textContent)).not.toContain("0.0/10");
    await act(async () => button.click());
    expect(container.querySelector("section")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows unavailable averages for weeks without runs", async () => {
    await act(async () => root.render(<RunScoreSummaryBadge label="Week 2" summary={summarizeRunScores([])} />));
    const button = container.querySelector("button")!;
    expect(button.textContent).toContain("Avg run score — · 0/0 runs");
    await act(async () => button.click());
    expect(container.querySelector("section")!.textContent).not.toContain("0.0/10");
  });
});
