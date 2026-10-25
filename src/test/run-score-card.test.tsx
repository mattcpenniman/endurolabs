import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import type { RunActivity } from "@/lib/activities/models";
import { buildRunScore, summarizeRunScores } from "@/lib/analytics/run-score";
import { RunScoreSummaryBadge } from "@/app/components/plan/RunScoreDetails";
import { buildActivitySplitOptions } from "@/lib/activities/activity-splits";
import RunStats from "@/app/components/plan/RunStats";
import { summarizeTimeAtEffort } from "@/lib/analytics/time-at-effort";
import { buildDynamicsReport } from "@/lib/activities/running-dynamics";
import { toBlob } from "html-to-image";

vi.mock("html-to-image", () => ({ toBlob: vi.fn() }));

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

  it("opens Stats for a summary-only run with moving time and unavailable effort", async () => {
    const run = { ...activity("stats-summary", 180), movingDurationSeconds: 1620 };
    await act(async () => root.render(<GarminActivityMapCard activities={[run]} />));
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Stats")!;
    await act(async () => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.textContent).toContain("Moving time27:00");
    expect(panel.textContent).toContain("Time outside moving3:00");
    expect(panel.textContent).toContain("Moving pace9:00/mi");
    expect(panel.textContent).toContain("Unavailable: linked plan zones");
    expect(panel.textContent).not.toContain("0%");
  });

  it("shows full-trace effort with classified-time percentages and missing metric time", async () => {
    const zone = (max: number) => ({ targetBpm: { min: 0, max }, hrrPercent: { min: 0, max: 1 }, hrMaxPercent: { min: 0, max: 1 } });
    const timeAtEffort = summarizeTimeAtEffort({
      durationSeconds: 120,
      heartRateZones: { recovery: zone(120), easy: zone(150), marathon: zone(165), threshold: zone(180), vo2: zone(190) },
      samples: [0, 10, 20, 30, 40, 100, 110, 120].map((elapsedSeconds) => ({
        elapsedSeconds, speedMetersPerSecond: 3, cadence: null, power: null,
        heartRate: elapsedSeconds <= 20 ? 140 : null,
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ samples: [], splits: [], timeAtEffort }) })));
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("stats-trace", 180)]} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Stats")!.click());
    const heartRate = container.querySelector('[aria-label="Heart rate effort"]')!;
    expect(heartRate.textContent).toContain("0:30 classified · 0:30 missing metric");
    expect(heartRate.textContent).toContain("Easy0:30 · 100%");
    expect(heartRate.textContent).toContain("Percentages use classified time only");
  });

  it("rejects inconsistent moving time and hides modeled power effort, with metric pace conversion", async () => {
    const run = { ...activity("stats-invalid", 180), movingDurationSeconds: 1801, averagePowerEstimated: true };
    const power = { totalSeconds: 60, unclassifiedSeconds: 0, buckets: [{ zone: "easy" as const, seconds: 60 }] };
    await act(async () => root.render(<RunStats activity={run} detail={{ samples: [], splits: [], timeAtEffort: { durationSeconds: 1800, heartRate: null, power } }} units="metric" />));
    expect(container.textContent).toContain("Moving time--");
    expect(container.querySelector('[aria-label="Measured power effort"]')!.textContent).toContain("Unavailable");
    await act(async () => root.render(<RunStats activity={{ ...run, movingDurationSeconds: 1620 }} detail={{ samples: [], splits: [] }} units="metric" />));
    expect(container.textContent).toContain("Moving pace5:36/km");
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

  it("shows measured dynamics, aligned pace and independent coverage in shared read-only Stats", async () => {
    const samples = [0, 10, 20].map((elapsedSeconds) => ({ elapsedSeconds, speedMetersPerSecond: 3,
      heartRate: 140, power: 300, cadence: 90, strideLengthCm: 109.14, verticalOscillationCm: 6.44,
      verticalRatioPercent: 5.71, groundContactTimeMs: 272.3, groundContactBalanceLeftPercent: null }));
    const dynamics = buildDynamicsReport(samples, 20);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ samples, splits: [], dynamics }) })));
    await act(async () => root.render(<GarminActivityMapCard activities={[{ ...activity("dynamics-shared", 180), strideLengthCm: 109.14 }]} detailUrlPrefix="/api/run/dynamics-token/activities" />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Stats")!.click());
    const panel = container.querySelector('[aria-label="Running dynamics"]')!;
    expect(panel.textContent).toContain("3.58 ft");
    expect(panel.textContent).toContain("20.0 s valid · 100% of eligible time");
    expect(panel.textContent).toContain("0.0 s valid · 0% of eligible time");
    expect(panel.textContent).not.toContain("50.00% left");
    expect(panel.textContent).toContain("Device and sensor differences");
    expect(panel.querySelector('svg')!.getAttribute("viewBox")).toBe("0 0 700 205");
    expect(panel.querySelector('svg')!.textContent).toContain("8:56/mi");
    expect(container.querySelector('select[aria-label="Target effort"]')).toBeNull();
    const metric = panel.querySelector("select")!;
    await act(async () => { metric.value = "groundContactBalanceLeftPercent"; metric.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(panel.querySelector("svg")).toBeNull();
    expect(panel.textContent).toContain("No complete chart intervals");
  });

  it("keeps summary-only dynamics distinct from trace and converts stride units", async () => {
    const run = { ...activity("dynamics-summary", 180), strideLengthCm: 109.14, groundContactBalanceLeftPercent: 50.79 };
    await act(async () => root.render(<RunStats activity={run} detail={{ samples: [], splits: [], dynamics: buildDynamicsReport([], 1800) }} units="metric" />));
    const panel = container.querySelector('[aria-label="Running dynamics"]')!;
    expect(panel.textContent).toContain("1.09 m");
    expect(panel.textContent).toContain("50.79% left / 49.21% right");
    expect(panel.textContent).toContain("Trace: Unavailable");
    expect(panel.textContent).toContain("no eligible time");
    expect(panel.querySelector("svg")).toBeNull();
  });

  it("never displays the previous activity's dynamics while a switched activity loads", async () => {
    const samples = [0, 10].map((elapsedSeconds) => ({ elapsedSeconds, speedMetersPerSecond: 3,
      heartRate: null, power: null, cadence: null, strideLengthCm: 150 }));
    let finish: ((value: unknown) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("dynamics-next") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ samples, splits: [], dynamics: buildDynamicsReport(samples, 10) }) })));
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("dynamics-first", 180), activity("dynamics-next", 180)]} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Stats")!.click());
    expect(container.textContent).toContain("Trace: 4.92 ft");
    const picker = container.querySelector("select")!;
    await act(async () => { picker.value = "dynamics-next"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).not.toContain("Trace: 4.92 ft");
    expect(container.textContent).toContain("Loading dynamics");
    await act(async () => finish?.({ ok: true, json: async () => ({ samples: [], splits: [], dynamics: buildDynamicsReport([], 10) }) }));
    expect(container.textContent).toContain("No complete chart intervals");
  });

  it("exports the visible responsive dynamics SVG through the existing PNG pipeline", async () => {
    const samples = [0, 10].map((elapsedSeconds) => ({ elapsedSeconds, speedMetersPerSecond: 3,
      heartRate: null, power: null, cadence: null, strideLengthCm: 109.14 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ samples, splits: [], dynamics: buildDynamicsReport(samples, 10) }) })));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("ClipboardItem", class { constructor(public data: unknown) {} });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.mocked(toBlob).mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    await act(async () => root.render(<GarminActivityMapCard activities={[activity("dynamics-export", 180)]} />));
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === "Stats")!.click());
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy image")!.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(toBlob).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ pixelRatio: 2, style: { overflow: "visible" } }));
    const node = vi.mocked(toBlob).mock.calls.at(-1)![0];
    expect(node.querySelector('svg[aria-label="Stride length and pace over elapsed time"]')).not.toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Image copied");
  });

  it.each(["/api/activities", "/api/run/split-token/activities"])("changes split analytics locally for %s", async (prefix) => {
    const splitOptions = buildActivitySplitOptions({
      summaryDistanceMeters: 1609.344 * 2,
      durationSeconds: 960,
      hasMeasuredPower: true,
      samples: [0, 480, 960].map((elapsedSeconds) => ({
        elapsedSeconds, speedMetersPerSecond: 3.5, heartRate: 140,
        power: 300, cadence: 90, elevationMeters: 100,
      })),
    });
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
      samples: [], splits: splitOptions.mile, splitOptions,
    }) }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<GarminActivityMapCard activities={[activity(`splits-${prefix}`, 180)]} detailUrlPrefix={prefix} />));
    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Split length"]')!;
    expect(selector.value).toBe("mile");
    expect([...selector.options].map((option) => option.text)).toEqual(["1 mile", "1 km", "0.5 mile", "0.25 mile"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    for (const [length, count] of [["kilometer", 4], ["half_mile", 4], ["quarter_mile", 8]] as const) {
      await act(async () => { selector.value = length; selector.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(container.querySelectorAll("tbody tr")).toHaveLength(count);
      expect(container.querySelector("tbody")!.textContent).toContain("300 W");
    }
    expect(container.querySelector("tbody")!.textContent).not.toContain("(0.25 mi)");
    await act(async () => { selector.value = "mile"; selector.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
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
